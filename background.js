/**
 * background.js — Service worker for Live Caption & Translate.
 *
 * Responsibilities:
 *  - Session lifecycle (start / pause / stop / clear)
 *  - LLM calls: Gemini (primary) → OpenRouter (fallback)
 *  - Offscreen document management for tab audio recording
 *  - Routing messages between content script ↔ offscreen ↔ service worker
 *  - Hotkey command handling
 */

'use strict';

// ─── Session state ────────────────────────────────────────────────────────────

const SESSION_DEFAULTS = {
  id:           null,
  status:       'idle',   // idle | running | paused | stopped
  startTime:    null,
  endTime:      null,
  elapsedMs:    0,
  tabId:        null,
  sourceLanguage: 'en-US',
  audioDataUrl:   null,
  audioDurationSec: 0,
  audioMimeType:  null,
  transcriptSegments:  [],
  translationSegments: [],
  summaries:           [],
  notes:               [],
  providerUsage: {
    primary:  0,
    fallback: 0,
    errors:   0,
    model:    null
  }
};

let session        = { ...SESSION_DEFAULTS };
let timerId        = null;
let timerStartTs   = null; // wall-clock when timer last started (to compute elapsed)
let offscreenReady = false;
let activeTabId    = null;

// ─── Startup: restore session from storage ────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get('session');
  if (data.session) {
    // Restore non-audio fields; audio blob is kept in separate key
    session = { ...SESSION_DEFAULTS, ...data.session, status: 'idle' };
  }
});

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dispatch(msg, sender, sendResponse);
  return true; // Keep message channel open for async responses
});

async function dispatch(msg, sender, sendResponse) {
  const tabId = sender.tab?.id ?? activeTabId;

  try {
    switch (msg.type) {
      case 'START_SESSION':
        await startSession(msg.tabId || tabId);
        sendResponse({ ok: true });
        break;

      case 'STOP_SESSION':
        await stopSession();
        sendResponse({ ok: true });
        break;

      case 'PAUSE_SESSION':
        togglePause();
        sendResponse({ ok: true });
        break;

      case 'STT_RESULT':
        await handleSTTResult(msg, tabId);
        sendResponse({ ok: true });
        break;

      case 'SAVE_NOTE':
        saveNote(msg.text, msg.timestampMs);
        sendResponse({ ok: true });
        break;

      case 'CLEAR_SESSION':
        await clearSession(tabId);
        sendResponse({ ok: true });
        break;

      case 'GET_STATE': {
        const { audioDataUrl, ...sessionWithoutBlob } = session;
        sendResponse({ session: sessionWithoutBlob });
        break;
      }

      case 'GET_EXPORT_DATA':
        sendResponse({ session });
        break;

      // ── From offscreen document ──────────────────────────────────────────
      case 'RECORDING_DONE':
        handleRecordingDone(msg.dataUrl, msg.mimeType, msg.durationSec);
        sendResponse({ ok: true });
        break;

      case 'RECORDING_ERROR':
        console.error('[bg] Recording error:', msg.message);
        notifyContent(activeTabId, { type: 'ERROR', message: `Recording error: ${msg.message}` });
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    console.error('[bg] dispatch error:', err);
    sendResponse({ error: err.message });
  }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

async function startSession(tabId) {
  if (session.status === 'running') return;

  activeTabId = tabId;
  const settings = await getSettings();

  session = {
    ...SESSION_DEFAULTS,
    id:             `session-${Date.now()}`,
    status:         'running',
    startTime:      Date.now(),
    tabId,
    sourceLanguage: settings.sourceLanguage || 'en-US',
    providerUsage: { primary: 0, fallback: 0, errors: 0, model: null }
  };

  startTimer();
  await saveSessionState();

  // Set up offscreen document and start recording
  const streamId = await getTabCaptureStreamId(tabId);
  if (streamId) {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: 'START_RECORDING', streamId });
  } else {
    notifyContent(tabId, {
      type: 'ERROR',
      message: 'Tab audio capture unavailable. Recording disabled; captions still work.'
    });
  }

  notifyContent(tabId, {
    type: 'SESSION_STATUS',
    status: 'running',
    elapsedMs: 0,
    provider: null
  });
}

async function stopSession() {
  if (session.status === 'idle') return;

  session.status  = 'stopped';
  session.endTime = Date.now();

  stopTimer();
  if (offscreenReady) {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  }

  await saveSessionState();
  notifyContent(activeTabId, {
    type: 'SESSION_STATUS',
    status: 'stopped',
    elapsedMs: session.elapsedMs
  });
}

function togglePause() {
  if (session.status === 'running') {
    session.status = 'paused';
    stopTimer();
    if (offscreenReady) {
      chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    }
  } else if (session.status === 'paused') {
    session.status = 'running';
    startTimer();
    if (offscreenReady) {
      chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    }
  }
  saveSessionState();
  notifyContent(activeTabId, {
    type: 'SESSION_STATUS',
    status: session.status,
    elapsedMs: session.elapsedMs
  });
}

async function clearSession(tabId) {
  stopTimer();
  if (offscreenReady) {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  }

  // Clear session data
  session = { ...SESSION_DEFAULTS };
  await chrome.storage.local.remove(['session']);

  notifyContent(tabId || activeTabId, {
    type: 'SESSION_STATUS',
    status: 'idle',
    elapsedMs: 0
  });

  activeTabId = null;
  console.log('[bg] session cleared.');
}

// ─── STT → LLM pipeline ───────────────────────────────────────────────────────

async function handleSTTResult(msg, tabId) {
  const { text, isFinal, startMs } = msg;

  // Store every final segment
  if (isFinal) {
    session.transcriptSegments.push({
      startMs,
      endMs:   Date.now() - session.startTime,
      text,
      isFinal: true
    });
  }

  if (!isFinal) return; // Only call LLM for final segments

  const settings = await getSettings();
  const hasKey   = settings.geminiKey || settings.openRouterKey;

  if (!hasKey) {
    notifyContent(tabId, {
      type:    'ERROR',
      message: 'No API key set. Open Options (extension icon → right-click → Options) to configure.'
    });
    await saveSessionState();
    return;
  }

  // Fire translation, and summary in parallel
  translateText(text, startMs, tabId, settings);

  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount >= 5) {
    summarizeText(text, startMs, tabId, settings);
  }

  await saveSessionState();
}

async function translateText(text, startMs, tabId, settings) {
  const prompt = `Translate to Vietnamese only. Output only the translation.\nText: ${text}`;

  try {
    const result = await callLLM(prompt, settings);
    session.translationSegments.push({ startMs, text: result });
    notifyContent(tabId, { type: 'TRANSLATION', text: result, startMs });
    await saveSessionState();
  } catch (err) {
    console.error('[bg] Translation failed:', err);
    notifyContent(tabId, { type: 'ERROR', message: `Translation: ${err.message}` });
  }
}

async function summarizeText(text, startMs, tabId, settings) {
  const prompt =
    `Summarize the following meeting segment in 1-2 concise Vietnamese sentences. ` +
    `Then list 3-5 keywords (key terms) found in the segment.

` +
    `Segment: ${text}\n\n` +
    `Respond in this exact format:\n` +
    `SUMMARY: <your summary here>\n` +
    `KEYWORDS: <comma-separated keywords>`;

  try {
    const result = await callLLM(prompt, settings);

    const summaryMatch   = result.match(/SUMMARY:\s*([\s\S]*?)(?:\nKEYWORDS:|$)/i);
    const keywordsMatch  = result.match(/KEYWORDS:\s*([\s\S]*)$/i);

    const summaryText = summaryMatch ? summaryMatch[1].trim() : result.trim();
    const keywords    = keywordsMatch
      ? keywordsMatch[1].split(',').map(k => k.trim()).filter(Boolean)
      : [];

    session.summaries.push({ startMs, summaryText, keywords });
    notifyContent(tabId, { type: 'SUMMARY', summaryText, keywords, startMs });
    await saveSessionState();
  } catch (err) {
    console.error('[bg] Summarize failed:', err);
    notifyContent(tabId, { type: 'ERROR', message: `Summary: ${err.message}` });
  }
}

// ─── LLM caller (Gemini → OpenRouter fallback) ────────────────────────────────

async function callLLM(prompt, settings) {
  const { geminiKey, openRouterKey, geminiModel, openRouterModel } = settings;

  // ── Try Gemini first ──
  if (geminiKey) {
    try {
      const model = geminiModel || 'gemini-2.5-flash';
      // v1 for stable/GA models; use v1beta if model name contains "exp" or "preview"
      const apiVer = /exp|preview|beta/i.test(model) ? 'v1beta' : 'v1';
      const url   = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${geminiKey}`;

      const requestBody = {
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.2 }
      };

      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 120)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini: empty response');

      session.providerUsage.primary++;
      session.providerUsage.model = model;
      return text.trim();
    } catch (err) {
      console.warn('[bg] Gemini failed, trying fallback:', err.message);
      session.providerUsage.errors++;
      if (!openRouterKey) throw err; // No fallback
    }
  }

  // ── OpenRouter fallback ──
  if (openRouterKey) {
    const model = openRouterModel || 'openai/gpt-4o-mini';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer':  'chrome-extension://live-caption-translate'
      },
      body: JSON.stringify({
        model,
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      session.providerUsage.errors++;
      throw new Error(`OpenRouter ${res.status}: ${errBody.slice(0, 120)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter: empty response');

    session.providerUsage.fallback++;
    session.providerUsage.model = model;
    return text.trim();
  }

  throw new Error('No API keys configured. Please open Options and add a Gemini or OpenRouter API key.');
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function saveNote(text, timestampMs) {
  session.notes.push({ timestampMs: timestampMs || Date.now(), text });
  saveSessionState();
}

// ─── Recording callback ───────────────────────────────────────────────────────

function handleRecordingDone(dataUrl, mimeType, durationSec) {
  session.audioDataUrl      = dataUrl;
  session.audioMimeType     = mimeType;
  session.audioDurationSec  = durationSec;

  // Persist only the metadata; audio blob is kept in memory and sent on demand
  saveSessionState();

  if (activeTabId && dataUrl) {
    notifyContent(activeTabId, {
      type:        'RECORDING_READY',
      mimeType,
      durationSec
    });
  }
}

// ─── Tab capture ──────────────────────────────────────────────────────────────

async function getTabCaptureStreamId(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError) {
          console.warn('[bg] tabCapture.getMediaStreamId:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(streamId);
        }
      });
    } catch (err) {
      console.warn('[bg] tabCapture unavailable:', err.message);
      resolve(null);
    }
  });
}

// ─── Offscreen document ───────────────────────────────────────────────────────

async function ensureOffscreen() {
  if (offscreenReady) return;

  try {
    // Check if document already exists (e.g. SW restarted)
    const existing = await chrome.offscreen.hasDocument?.();
    if (existing) {
      offscreenReady = true;
      return;
    }
  } catch (_) { /* hasDocument may not exist in older Chrome */ }

  try {
    await chrome.offscreen.createDocument({
      url:         chrome.runtime.getURL('offscreen.html'),
      reasons:     ['USER_MEDIA'],
      justification: 'Record tab audio for session transcript'
    });
    offscreenReady = true;
  } catch (err) {
    if (err.message?.includes('already exists')) {
      offscreenReady = true;
    } else {
      console.error('[bg] Failed to create offscreen document:', err);
    }
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  timerStartTs = Date.now() - session.elapsedMs;

  timerId = setInterval(async () => {
    session.elapsedMs = Date.now() - timerStartTs;

    // Auto-stop at session time limit
    const settings = await getSettings();
    const limitMs  = (settings.sessionLimitMin || 60) * 60 * 1000;
    if (session.elapsedMs >= limitMs) {
      await stopSession();
      return;
    }

    notifyContent(activeTabId, {
      type:      'SESSION_STATUS',
      status:    session.status,
      elapsedMs: session.elapsedMs,
      provider:  session.providerUsage.model
    });
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function saveSessionState() {
  // Don't persist the large audio data URL to storage (keep in memory only)
  const { audioDataUrl, ...sessionMeta } = session;
  await chrome.storage.local.set({ session: sessionMeta });
}

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || {};
}

// ─── Content script messaging ─────────────────────────────────────────────────

function notifyContent(tabId, msg) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may have closed or content script not ready — silently ignore
  });
}

// ─── Hotkey commands ──────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const tabs  = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;

  switch (command) {
    case 'toggle-listening':
      if (session.status === 'idle' || session.status === 'stopped') {
        await startSession(tabId);
      } else {
        await stopSession();
      }
      break;

    case 'pause-session':
      togglePause();
      break;

    case 'clear-session':
      await clearSession(tabId);
      break;
  }
});
