'use strict';

// Domains where the content script auto-injects (must match manifest content_scripts matches)
const AUTO_DOMAINS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'chime.aws',
  'skype.com'
];

function fmt(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function el(id) { return document.getElementById(id); }

function isAutoSite(hostname) {
  return AUTO_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

// ─── Check whether overlay is already injected on the given tab ───────────────

async function isOverlayInjected(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func:   () => !!document.getElementById('ica-overlay')
    });
    return result?.[0]?.result === true;
  } catch (_) {
    return false;
  }
}

// ─── Inject overlay into an arbitrary tab ─────────────────────────────────────

async function injectOverlay(tabId) {
  // Insert CSS first
  await chrome.scripting.insertCSS({
    target: { tabId },
    files:  ['content/overlay.css']
  });
  // Then inject scripts in order (glossary must come before overlay)
  await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['glossary.js']
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['content/overlay.js']
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init() {
  // Load session status from background
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    const s = res?.session;
    if (!s) return;

    const statusEl = el('st-status');
    statusEl.textContent = s.status || 'idle';
    statusEl.className   = `status-val ${s.status || 'idle'}`;

    el('st-elapsed').textContent  = s.elapsedMs ? fmt(s.elapsedMs) : '—';
    el('st-model').textContent    = s.providerUsage?.model || '—';
    el('st-segments').textContent = s.transcriptSegments?.length ?? 0;
  });

  // Get the current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) return;

  const url      = tab.url || '';
  const isHttp   = url.startsWith('http://') || url.startsWith('https://');
  const hostname = isHttp ? new URL(url).hostname : '';
  const autoSite = isAutoSite(hostname);

  // Show domain in tab info
  el('tab-domain').textContent = hostname || (url.startsWith('chrome') ? 'Chrome system page' : 'Unknown');

  if (!isHttp) {
    // Can't inject on chrome://, chrome-extension://, etc.
    el('tab-badge').textContent  = 'N/A';
    el('tab-badge').className    = 'badge badge-manual';
    el('tab-desc').textContent   = 'Cannot activate on browser system pages.';
    el('btn-activate').disabled  = true;
    el('activate-section').style.display = 'block';
    return;
  }

  if (autoSite) {
    // Known video call site — should already be injected (or will be on page load)
    const injected = await isOverlayInjected(tab.id);
    el('tab-badge').textContent = injected ? '✓ Active' : 'Auto';
    el('tab-badge').className   = injected ? 'badge badge-active' : 'badge badge-auto';
    el('tab-desc').textContent  = injected
      ? 'Overlay is running on this page.'
      : 'Auto-activates on page load. Refresh the tab if not visible.';

    if (!injected) {
      // Offer to inject immediately without a page reload
      el('btn-activate').textContent = '⚡ Inject now (no reload needed)';
      el('activate-section').style.display = 'block';
    } else {
      el('activate-section').style.display = 'none';
    }
  } else {
    // Unknown site — show manual activate button
    const injected = await isOverlayInjected(tab.id);
    if (injected) {
      el('tab-badge').textContent = '✓ Active';
      el('tab-badge').className   = 'badge badge-active';
      el('tab-desc').textContent  = 'Overlay is already running on this page.';
      el('activate-section').style.display = 'none';
    } else {
      el('tab-badge').textContent = 'Manual';
      el('tab-badge').className   = 'badge badge-manual';
      el('tab-desc').textContent  = 'Click Activate to inject the overlay on this page.';
      el('activate-section').style.display = 'block';
    }
  }

  // ── Activate button handler ──
  el('btn-activate').addEventListener('click', async () => {
    const btn    = el('btn-activate');
    const status = el('inject-status');

    btn.disabled    = true;
    btn.textContent = 'Injecting…';
    status.textContent = '';
    status.className   = '';

    try {
      await injectOverlay(tab.id);
      status.textContent = '✓ Overlay injected successfully!';
      status.className   = 'ok';
      btn.textContent    = '✓ Done';

      // Update badge
      el('tab-badge').textContent = '✓ Active';
      el('tab-badge').className   = 'badge badge-active';
      el('tab-desc').textContent  = 'Overlay is running on this page.';

      setTimeout(() => window.close(), 1200);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className   = 'err';
      btn.disabled       = false;
      btn.textContent    = '⚡ Activate on this tab';
      console.error('[popup] Inject failed:', err);
    }
  });
}

document.getElementById('btn-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
