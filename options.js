/**
 * options.js — Settings page logic for Live Caption & Translate.
 */

'use strict';

// ─── Helpers: custom model field takes precedence over select ─────────────────

/** Return custom text field value if non-empty, otherwise fall back to select. */
function getModel(selectId, customId) {
  const custom = getValue(customId).trim();
  return custom || getValue(selectId);
}

/** When loading, if the saved model is not in the select options, populate the custom field. */
function setModel(selectId, customId, savedValue) {
  if (!savedValue) return;
  const select  = document.getElementById(selectId);
  const options = select ? [...select.options].map(o => o.value) : [];
  if (options.includes(savedValue)) {
    setValue(selectId, savedValue);
    setValue(customId, '');
  } else {
    // Not a known option — put it in the custom field
    setValue(customId, savedValue);
  }
}

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  const s    = data.settings || {};

  setValue('gemini-key',      s.geminiKey     || '');
  setModel('gemini-model', 'gemini-model-custom', s.geminiModel || 'gemini-2.5-flash');

  setValue('openrouter-key',  s.openRouterKey || '');
  setModel('openrouter-model', 'openrouter-model-custom', s.openRouterModel || 'openai/gpt-4o-mini');

  setValue('source-language',  s.sourceLanguage  || 'en-US');
  setValue('session-limit',    s.sessionLimitMin || 60);
  setChecked('show-interim',       s.showInterim       ?? true);
  setChecked('auto-scroll',        s.autoScroll        ?? true);
  setChecked('highlight-glossary', s.highlightGlossary ?? true);
}

// ─── Save settings ────────────────────────────────────────────────────────────

async function saveSettings() {
  const settings = {
    geminiKey:         getValue('gemini-key').trim(),
    geminiModel:       getModel('gemini-model', 'gemini-model-custom'),
    openRouterKey:     getValue('openrouter-key').trim(),
    openRouterModel:   getModel('openrouter-model', 'openrouter-model-custom'),
    sourceLanguage:    getValue('source-language'),
    sessionLimitMin:   parseInt(getValue('session-limit'), 10) || 60,
    showInterim:       getChecked('show-interim'),
    autoScroll:        getChecked('auto-scroll'),
    highlightGlossary: getChecked('highlight-glossary')
  };

  await chrome.storage.local.set({ settings });

  showBanner('opt-saved-banner');
  setTimeout(() => hideBanner('opt-saved-banner'), 3000);
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;

  setValue('gemini-key',              '');
  setValue('gemini-model',            'gemini-2.5-flash');
  setValue('gemini-model-custom',     '');
  setValue('openrouter-key',          '');
  setValue('openrouter-model',        'openai/gpt-4o-mini');
  setValue('openrouter-model-custom', '');
  setValue('source-language',         'en-US');
  setValue('session-limit',           60);
  setChecked('show-interim',       true);
  setChecked('auto-scroll',        true);
  setChecked('highlight-glossary', true);
}

// ─── Test connections ─────────────────────────────────────────────────────────

async function testGemini() {
  const key   = getValue('gemini-key').trim();
  const model = getModel('gemini-model', 'gemini-model-custom');
  const btn   = document.getElementById('test-gemini');

  if (!key) { showError('Enter a Gemini API key first.'); return; }

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    // Use v1 for stable/GA models; v1beta for experimental
    const apiVer = /exp|preview|beta/i.test(model) ? 'v1beta' : 'v1';
    const url    = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${key}`;

    const reqBody = {
      contents:         [{ parts: [{ text: 'Reply with only: OK' }] }],
      generationConfig: { maxOutputTokens: 10 }
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    showSuccess(`Gemini OK (${model}): "${(text || '').trim().slice(0, 40)}"`);
  } catch (err) {
    showError(`Gemini test failed: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Test';
  }
}

async function testOpenRouter() {
  const key   = getValue('openrouter-key').trim();
  const model = getModel('openrouter-model', 'openrouter-model-custom');
  const btn   = document.getElementById('test-openrouter');

  if (!key) { showError('Enter an OpenRouter API key first.'); return; }

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer':  location.href
      },
      body: JSON.stringify({
        model,
        messages:   [{ role: 'user', content: 'Reply with only: OK' }],
        max_tokens: 10
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    showSuccess(`OpenRouter OK (${model}): "${(text || '').trim().slice(0, 40)}"`);
  } catch (err) {
    showError(`OpenRouter test failed: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Test';
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function getValue(id)       { return document.getElementById(id)?.value ?? ''; }
function setValue(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }
function getChecked(id)     { return document.getElementById(id)?.checked ?? false; }
function setChecked(id, v)  { const el = document.getElementById(id); if (el) el.checked = !!v; }

function showBanner(id) {
  document.getElementById(id)?.removeAttribute('hidden');
}

function hideBanner(id) {
  document.getElementById(id)?.setAttribute('hidden', '');
}

function showError(msg) {
  const el = document.getElementById('opt-error-banner');
  if (!el) return;
  el.textContent = msg;
  el.removeAttribute('hidden');
  setTimeout(() => el.setAttribute('hidden', ''), 7000);
}

function showSuccess(msg) {
  const el = document.getElementById('opt-saved-banner');
  if (!el) return;
  el.textContent = msg;
  el.removeAttribute('hidden');
  setTimeout(() => el.setAttribute('hidden', ''), 4000);
}

// ─── Toggle password visibility ───────────────────────────────────────────────

function setupToggles() {
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.toggle);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function updateActiveModel(selectId, customId, labelId) {
  const active = getModel(selectId, customId);
  const label  = document.getElementById(labelId);
  if (label) label.textContent = active ? `→ Will use: ${active}` : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupToggles();

  // Clear buttons
  document.getElementById('clear-gemini-custom').addEventListener('click', () => {
    setValue('gemini-model-custom', '');
    updateActiveModel('gemini-model', 'gemini-model-custom', 'gemini-active-model');
  });
  document.getElementById('clear-or-custom').addEventListener('click', () => {
    setValue('openrouter-model-custom', '');
    updateActiveModel('openrouter-model', 'openrouter-model-custom', 'or-active-model');
  });

  // Live "Using:" indicators — update whenever dropdown or custom field changes
  ['gemini-model', 'gemini-model-custom'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () =>
      updateActiveModel('gemini-model', 'gemini-model-custom', 'gemini-active-model'));
    document.getElementById(id)?.addEventListener('change', () =>
      updateActiveModel('gemini-model', 'gemini-model-custom', 'gemini-active-model'));
  });
  ['openrouter-model', 'openrouter-model-custom'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () =>
      updateActiveModel('openrouter-model', 'openrouter-model-custom', 'or-active-model'));
    document.getElementById(id)?.addEventListener('change', () =>
      updateActiveModel('openrouter-model', 'openrouter-model-custom', 'or-active-model'));
  });

  // Show initial state
  updateActiveModel('gemini-model', 'gemini-model-custom', 'gemini-active-model');
  updateActiveModel('openrouter-model', 'openrouter-model-custom', 'or-active-model');


  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-btn').addEventListener('click', resetSettings);
  document.getElementById('test-gemini').addEventListener('click', testGemini);
  document.getElementById('test-openrouter').addEventListener('click', testOpenRouter);
});
