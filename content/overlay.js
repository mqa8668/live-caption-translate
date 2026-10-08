/**
 * content/overlay.js — Live Caption & Translate overlay.
 *
 * Injected into meet.google.com. Responsibilities:
 *  - Create and manage the floating overlay UI
 *  - Run SpeechRecognition for live captions (mic captures ambient + user audio)
 *  - Send final STT segments to the background service worker
 *  - Receive TRANSLATION / SUMMARY / SESSION_STATUS / ERROR from background
 *  - Handle export to JSON / TXT / WebM
 *  - Draggable overlay, collapsible, notes panel
 */

(function () {
  'use strict';

  if (document.getElementById('ica-overlay')) return; // Already injected

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    status:         'idle',   // idle | running | paused | stopped
    elapsedMs:      0,
    provider:       null,
    sessionStartMs: null,
    interimText:    '',
    audioDataUrl:   null,
    audioMimeType:  null,
    // Full session data (received back from BG for export)
    sessionData:    null
  };

  let recognition      = null;
  let recognitionActive = false;
  let lastNoteText     = '';

  // ─── DOM references ─────────────────────────────────────────────────────────
  let elOverlay, elRecDot, elStatusText, elTimer,
      elEngBody, elViBody, elSummaryText, elKeywords,
      elNotes, elBtnStart, elBtnPause,
      elBtnStop, elBtnExport, elBtnClear, elToast;

  // ─── Build overlay ──────────────────────────────────────────────────────────

  function buildOverlay() {
    elOverlay = el('div', { id: 'ica-overlay' });

    // ── Header ──
    const header = el('div', { class: 'ica-header' });

    elRecDot     = el('span', { class: 'ica-rec-dot' });
    elStatusText = el('span', {}, 'Idle');
    elTimer      = el('span', {}, '');

    const headerStatus = el('div', { class: 'ica-header-status' });
    headerStatus.append(elRecDot, elStatusText, elTimer);

    const headerBtns = el('div', { class: 'ica-header-btns' });
    const collapseBtn = el('button', { class: 'ica-icon-btn', title: 'Collapse / expand', id: 'ica-collapse-btn' }, '−');
    headerBtns.append(collapseBtn);

    header.append(
      el('span', { class: 'ica-header-title' }, 'Caption & Translate'),
      headerStatus,
      headerBtns
    );

    // ── Privacy note ──
    const privacy = el('div', { class: 'ica-privacy' }, "Let participants know you're captioning this call.");

    // ── Columns ──
    const columns = el('div', { class: 'ica-columns' });

    const colEn = el('div', { class: 'ica-col' });
    colEn.append(
      el('div', { class: 'ica-col-header' }, '🇬🇧 English (live)'),
    );
    elEngBody = el('div', { class: 'ica-col-body', id: 'ica-eng-body' });
    colEn.append(elEngBody);

    const colVi = el('div', { class: 'ica-col' });
    colVi.append(
      el('div', { class: 'ica-col-header' }, '🇻🇳 Vietnamese')
    );
    elViBody = el('div', { class: 'ica-col-body', id: 'ica-vi-body' });
    colVi.append(elViBody);

    columns.append(colEn, colVi);

    // ── Summary panel ──
    const summaryPanel = el('div', { class: 'ica-summary-panel', id: 'ica-summary-panel' });

    summaryPanel.append(el('div', { class: 'ica-summary-label' }, 'Summary'));

    elSummaryText = el('div', { class: 'ica-summary-text', id: 'ica-summary-text' }, 'Waiting for speech…');
    elKeywords    = el('div', { class: 'ica-keywords', id: 'ica-keywords' });

    summaryPanel.append(elSummaryText, elKeywords);

    // ── Notes ──
    const notesPanel = el('div', { class: 'ica-notes-panel' });
    notesPanel.append(el('div', { class: 'ica-notes-label' }, 'Notes'));
    elNotes = el('textarea', {
      class:       'ica-notes-input',
      id:          'ica-notes',
      placeholder: 'Type notes here…',
      rows:        3
    });
    notesPanel.append(elNotes);

    // ── Controls ──
    const controls = el('div', { class: 'ica-controls' });

    elBtnStart  = el('button', { class: 'ica-btn ica-btn--start',  id: 'ica-btn-start'  }, 'Start');
    elBtnPause  = el('button', { class: 'ica-btn ica-btn--pause',  id: 'ica-btn-pause',  disabled: '' }, 'Pause');
    elBtnStop   = el('button', { class: 'ica-btn ica-btn--stop',   id: 'ica-btn-stop',   disabled: '' }, 'Stop');
    elBtnExport = el('button', { class: 'ica-btn ica-btn--export', id: 'ica-btn-export', disabled: '' }, 'Export');
    elBtnClear  = el('button', { class: 'ica-btn ica-btn--clear',  id: 'ica-btn-clear'  }, 'Clear');

    controls.append(elBtnStart, elBtnPause, elBtnStop, elBtnExport, elBtnClear);

    // Assemble overlay
    elOverlay.append(header, privacy, columns, summaryPanel, notesPanel, controls);

    // Toast (appended to body, not overlay)
    elToast = el('div', { class: 'ica-toast', id: 'ica-toast' });
    document.body.appendChild(elToast);

    document.body.appendChild(elOverlay);

    // Wire events
    wireEvents(collapseBtn);
    makeDraggable(header);

    // Restore overlay position if saved
    restorePosition();
  }

  // ─── Element factory ────────────────────────────────────────────────────────

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'disabled' && v === '') e.disabled = true;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v);
    }
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  function wireEvents(collapseBtn) {
    elBtnStart.addEventListener('click', onStart);
    elBtnPause.addEventListener('click', onPause);
    elBtnStop.addEventListener('click',  onStop);
    elBtnExport.addEventListener('click', onExport);
    elBtnClear.addEventListener('click',  onClear);

    collapseBtn.addEventListener('click', () => {
      const collapsed = elOverlay.classList.toggle('ica-collapsed');
      collapseBtn.textContent = collapsed ? '+' : '−';
    });

    // Auto-save notes on blur / enter
    elNotes.addEventListener('blur', saveNoteIfChanged);
    elNotes.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) saveNoteIfChanged();
    });
  }

  function saveNoteIfChanged() {
    const text = elNotes.value.trim();
    if (!text || text === lastNoteText || state.status === 'idle') return;
    lastNoteText = text;
    chrome.runtime.sendMessage({ type: 'SAVE_NOTE', text, timestampMs: Date.now() });
  }

  // ─── Draggable header ───────────────────────────────────────────────────────

  function makeDraggable(handle) {
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('ica-icon-btn')) return;
      dragging = true;
      ox = e.clientX - elOverlay.getBoundingClientRect().left;
      oy = e.clientY - elOverlay.getBoundingClientRect().top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      if (!dragging) return;
      const x = e.clientX - ox;
      const y = e.clientY - oy;
      elOverlay.style.left  = `${Math.max(0, x)}px`;
      elOverlay.style.top   = `${Math.max(0, y)}px`;
      elOverlay.style.right = 'auto';
      savePosition(x, y);
    }

    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  function savePosition(x, y) {
    sessionStorage.setItem('ica-pos', JSON.stringify({ x, y }));
  }

  function restorePosition() {
    try {
      const pos = JSON.parse(sessionStorage.getItem('ica-pos') || 'null');
      if (pos) {
        elOverlay.style.left  = `${pos.x}px`;
        elOverlay.style.top   = `${pos.y}px`;
        elOverlay.style.right = 'auto';
      }
    } catch (_) { /* ignore */ }
  }

  // ─── Button handlers ────────────────────────────────────────────────────────

  async function onStart() {
    if (state.status === 'running') return;

    state.sessionStartMs = Date.now();
    state.sessionData    = null;
    state.audioDataUrl   = null;

    // Clear UI
    elEngBody.innerHTML    = '';
    elViBody.innerHTML     = '';
    elSummaryText.textContent = 'Waiting for speech…';
    elKeywords.innerHTML   = '';

    // Ask background to start session (tab audio capture + recording)
    chrome.runtime.sendMessage({ type: 'START_SESSION' }, (res) => {
      if (chrome.runtime.lastError) {
        showToast(`Could not start session: ${chrome.runtime.lastError.message}`);
      }
    });

    // Start SpeechRecognition locally
    startRecognition();
  }

  function onPause() {
    chrome.runtime.sendMessage({ type: 'PAUSE_SESSION' });
    if (state.status === 'running') {
      pauseRecognition();
    } else if (state.status === 'paused') {
      resumeRecognition();
    }
  }

  async function onStop() {
    chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
    stopRecognition();
    saveNoteIfChanged();
  }

  function onClear() {
    if (!confirm("Stop and clear this session's captions and notes?")) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' });
    stopRecognition();
    state.audioDataUrl = null;
    state.sessionData  = null;
    elEngBody.innerHTML = '';
    elViBody.innerHTML  = '';
    elSummaryText.textContent = 'Session cleared.';
    elKeywords.innerHTML = '';
    elNotes.value        = '';
    lastNoteText         = '';
    setUIState('idle');
    showToast('Session cleared.', 3000);
  }

  function onExport() {
    chrome.runtime.sendMessage({ type: 'GET_EXPORT_DATA' }, (res) => {
      if (!res || !res.session) {
        showToast('No session data to export.');
        return;
      }
      showExportModal(res.session);
    });
  }

  // ─── Export modal ────────────────────────────────────────────────────────────

  function showExportModal(session) {
    const backdrop = el('div', { class: 'ica-modal-backdrop', id: 'ica-modal-backdrop' });
    const modal    = el('div', { class: 'ica-modal' });

    const closeBtn = el('button', { class: 'ica-modal-close', title: 'Close' }, '×');
    closeBtn.addEventListener('click', () => backdrop.remove());

    const title = el('h3', {}, 'Export Session');

    const btnJson = el('button', { class: 'ica-modal-btn' }, 'JSON — full session data');
    btnJson.addEventListener('click', () => { exportJSON(session); backdrop.remove(); });

    const btnTxt = el('button', { class: 'ica-modal-btn' }, 'TXT — readable transcript');
    btnTxt.addEventListener('click', () => { exportTXT(session); backdrop.remove(); });

    const btnAudio = el('button', { class: 'ica-modal-btn' }, 'Audio — WebM recording');
    if (!session.audioDataUrl && !state.audioDataUrl) {
      btnAudio.disabled = true;
      btnAudio.title    = 'No audio recorded (tab capture may not have been available)';
    }
    btnAudio.addEventListener('click', () => { exportAudio(session); backdrop.remove(); });

    const btnsMdl = el('div', { class: 'ica-modal-btns' });
    btnsMdl.append(btnJson, btnTxt, btnAudio);

    modal.append(closeBtn, title, btnsMdl);
    backdrop.append(modal);

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    document.body.appendChild(backdrop);
  }

  function exportJSON(session) {
    const { audioDataUrl, ...meta } = session; // Don't include massive data URL in JSON
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `meeting-session-${dateStr()}.json`);
  }

  function exportTXT(session) {
    const lines = [];
    lines.push('Live Caption & Translate — Meeting Transcript');
    lines.push('='.repeat(60));
    lines.push(`Session ID : ${session.id || 'unknown'}`);
    lines.push(`Start      : ${session.startTime ? new Date(session.startTime).toLocaleString() : '—'}`);
    lines.push(`End        : ${session.endTime   ? new Date(session.endTime).toLocaleString()   : '—'}`);
    lines.push(`Duration   : ${formatMs(session.elapsedMs || 0)}`);
    lines.push(`Model      : ${session.providerUsage?.model || '—'}`);
    lines.push('');
    lines.push('TRANSCRIPT & TRANSLATION');
    lines.push('-'.repeat(60));

    const segments     = session.transcriptSegments     || [];
    const translations = session.translationSegments    || [];

    segments.forEach((seg, i) => {
      const ts  = formatMs(seg.startMs || 0);
      const vi  = translations[i]?.text || '';
      lines.push(`[${ts}] EN: ${seg.text}`);
      if (vi) lines.push(`       VI: ${vi}`);
    });

    lines.push('');
    lines.push('SUMMARIES');
    lines.push('-'.repeat(60));
    (session.summaries || []).forEach(s => {
      const ts = formatMs(s.startMs || 0);
      lines.push(`[${ts}] ${s.summaryText}`);
      if (s.keywords?.length) lines.push(`       Keywords: ${s.keywords.join(', ')}`);
    });

    if (session.notes?.length) {
      lines.push('');
      lines.push('NOTES');
      lines.push('-'.repeat(60));
      session.notes.forEach(n => {
        const ts = new Date(n.timestampMs).toLocaleTimeString();
        lines.push(`[${ts}] ${n.text}`);
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `meeting-transcript-${dateStr()}.txt`);
  }

  function exportAudio(session) {
    const dataUrl = session.audioDataUrl || state.audioDataUrl;
    if (!dataUrl) { showToast('No audio data available.'); return; }

    const mimeType = session.audioMimeType || 'audio/webm';
    const ext      = mimeType.includes('ogg') ? 'ogg' : (mimeType.includes('mp4') ? 'mp4' : 'webm');

    // Convert data URL to blob
    fetch(dataUrl)
      .then(r => r.blob())
      .then(blob => triggerDownload(blob, `meeting-audio-${dateStr()}.${ext}`))
      .catch(err => showToast(`Audio export failed: ${err.message}`));
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ─── SpeechRecognition ───────────────────────────────────────────────────────

  function startRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showToast('SpeechRecognition is not supported in this browser. Use Chrome 33+.');
      setUIState('idle');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();

    // Get language from storage (fallback to en-US)
    chrome.storage.local.get('settings', ({ settings }) => {
      const lang = settings?.sourceLanguage || 'en-US';
      recognition.lang = lang;
    });

    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionActive = true;
      console.log('[ica] SpeechRecognition started');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text   = result[0].transcript;

        if (result.isFinal) {
          const startMs = state.sessionStartMs ? Date.now() - state.sessionStartMs : 0;
          appendSegment(elEngBody, text, true, startMs);
          // Send final text to background for translation + summary
          chrome.runtime.sendMessage({
            type:    'STT_RESULT',
            text:    text.trim(),
            isFinal: true,
            startMs
          });
        } else {
          interim += text;
        }
      }

      // Update interim display
      state.interimText = interim;
      updateInterim(interim);
    };

    recognition.onerror = (event) => {
      console.warn('[ica] SpeechRecognition error:', event.error);
      if (event.error === 'not-allowed') {
        showToast('Microphone access denied. Grant permission and try again.');
        stopRecognition();
      } else if (event.error === 'no-speech') {
        // Ignore — just no audio detected yet
      } else if (event.error === 'audio-capture') {
        showToast('No microphone detected.');
      } else if (event.error === 'network') {
        showToast('STT network error. Retrying…');
      }
    };

    recognition.onend = () => {
      recognitionActive = false;
      // Auto-restart if session still running
      if (state.status === 'running') {
        setTimeout(() => {
          if (state.status === 'running' && !recognitionActive) {
            try { recognition.start(); } catch (_) { /* already started */ }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error('[ica] recognition.start() failed:', err);
      showToast(`SpeechRecognition failed to start: ${err.message}`);
    }
  }

  function pauseRecognition() {
    if (recognition && recognitionActive) {
      recognition.stop();
      recognitionActive = false;
    }
  }

  function resumeRecognition() {
    if (recognition && !recognitionActive && state.status === 'running') {
      try { recognition.start(); } catch (_) {}
    }
  }

  function stopRecognition() {
    if (recognition) {
      recognition.onend = null; // Prevent auto-restart
      recognition.stop();
      recognitionActive = false;
    }
  }

  // ─── Caption display ─────────────────────────────────────────────────────────

  function appendSegment(container, text, isFinal, startMs) {
    // Remove existing interim span if any
    const existingInterim = container.querySelector('.ica-interim');
    if (existingInterim) existingInterim.remove();

    if (!isFinal) {
      const span = el('div', { class: 'ica-segment ica-interim' });
      span.textContent = text;
      container.appendChild(span);
    } else {
      const div = el('div', { class: 'ica-segment ica-final' });
      const ts  = el('span', { class: 'ica-timestamp' }, `[${formatMs(startMs)}]`);
      const content = el('span', {});
      content.innerHTML = highlightGlossary(escapeHtml(text));
      div.append(ts, content);
      container.appendChild(div);
      autoScroll(container);
    }
  }

  function updateInterim(text) {
    const existing = elEngBody.querySelector('.ica-interim');
    if (!text) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.textContent = text;
    } else {
      const span = el('div', { class: 'ica-segment ica-interim' });
      span.textContent = text;
      elEngBody.appendChild(span);
    }
    autoScroll(elEngBody);
  }

  function autoScroll(container) {
    container.scrollTop = container.scrollHeight;
  }

  // ─── Glossary highlighting ───────────────────────────────────────────────────

  function highlightGlossary(html) {
    if (!window.ICA_GLOSSARY) return html;
    // Sort terms longest-first to avoid partial matches
    const terms = Object.keys(window.ICA_GLOSSARY).sort((a, b) => b.length - a.length);

    for (const term of terms) {
      const escaped  = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex    = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
      const def      = escapeHtml(window.ICA_GLOSSARY[term]);
      html = html.replace(regex, (match) =>
        `<span class="ica-term" title="${def}">${match}</span>`
      );
    }
    return html;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Background message handling ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'TRANSLATION':
        appendSegment(elViBody, msg.text, true, msg.startMs);
        break;

      case 'SUMMARY':
        updateSummary(msg.summaryText, msg.keywords, msg.startMs);
        break;

      case 'SESSION_STATUS':
        state.status    = msg.status;
        state.elapsedMs = msg.elapsedMs || 0;
        state.provider  = msg.provider  || state.provider;
        setUIState(msg.status, msg.elapsedMs, msg.provider);
        break;

      case 'RECORDING_READY':
        state.audioMimeType = msg.mimeType;
        showToast('Recording ready for export.', 2500);
        break;

      case 'ERROR':
        showToast(msg.message, 6000);
        break;
    }
  });

  // ─── Summary panel ──────────────────────────────────────────────────────────

  function updateSummary(summaryText, keywords, startMs) {
    elSummaryText.textContent = summaryText || '';

    // Keywords
    elKeywords.innerHTML = '';
    (keywords || []).forEach(kw => {
      const span = el('span', { class: 'ica-keyword' });
      span.textContent = kw;
      elKeywords.appendChild(span);
    });
  }

  // ─── UI state ────────────────────────────────────────────────────────────────

  function setUIState(status, elapsedMs, provider) {
    state.status    = status;
    state.elapsedMs = elapsedMs ?? state.elapsedMs;

    const running = status === 'running';
    const paused  = status === 'paused';
    const stopped = status === 'stopped';
    const idle    = status === 'idle';

    elBtnStart.disabled  = running || paused;
    elBtnPause.disabled  = !(running || paused);
    elBtnStop.disabled   = idle;
    elBtnExport.disabled = idle;

    elBtnStart.textContent  = idle || stopped ? 'Start' : 'Running';
    elBtnPause.textContent  = paused ? 'Resume' : 'Pause';

    // Status indicator
    elRecDot.className = 'ica-rec-dot' + (running ? ' ica-rec-active' : (paused ? ' ica-rec-paused' : ''));

    const statusLabel = running ? '● REC' : (paused ? 'PAUSED' : (stopped ? 'STOPPED' : '○ IDLE'));
    const provLbl     = provider ? ` | ${provider}` : '';
    elStatusText.textContent = `${statusLabel}${provLbl}`;

    if (elapsedMs !== undefined) {
      elTimer.textContent = running || paused ? ` ${formatMs(elapsedMs)}` : '';
    }
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  function showToast(msg, ms = 5000) {
    elToast.textContent = msg;
    elToast.style.display = 'block';
    clearTimeout(elToast._tid);
    elToast._tid = setTimeout(() => { elToast.style.display = 'none'; }, ms);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function formatMs(ms) {
    const totalSec = Math.floor((ms || 0) / 1000);
    const m        = Math.floor(totalSec / 60);
    const s        = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function dateStr() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  buildOverlay();

  // Sync status from background on load
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (res?.session) {
      setUIState(res.session.status, res.session.elapsedMs, res.session.providerUsage?.model);
    }
  });

})();
