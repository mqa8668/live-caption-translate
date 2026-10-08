/**
 * offscreen.js — Tab audio capture and MediaRecorder.
 *
 * Lifecycle:
 *  1. Background sends START_RECORDING { streamId } → open getUserMedia, start MediaRecorder.
 *  2. Background sends PAUSE_RECORDING  → pause MediaRecorder.
 *  3. Background sends RESUME_RECORDING → resume MediaRecorder.
 *  4. Background sends STOP_RECORDING   → stop MediaRecorder, collect chunks, send RECORDING_DONE.
 */

'use strict';

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;
let startTs       = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING':
      startRecording(msg.streamId).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true; // keep channel open

    case 'PAUSE_RECORDING':
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
      }
      sendResponse({ ok: true });
      break;

    case 'RESUME_RECORDING':
      if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
      }
      sendResponse({ ok: true });
      break;

    case 'STOP_RECORDING':
      stopRecording().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;

    default:
      break;
  }
});

async function startRecording(streamId) {
  // Stop any previous recording
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }

  audioChunks = [];
  startTs     = Date.now();

  // Open the tab audio stream using the stream ID provided by tabCapture.getMediaStreamId
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource:   'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // ── Fix: tabCapture silences the tab — pipe audio back to speakers ──────
    const audioCtx = new AudioContext();
    const source   = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);
    // Keep audioCtx alive on the stream object so it isn't GC'd
    stream._audioCtx = audioCtx;
  } catch (err) {
    console.error('[offscreen] getUserMedia failed:', err);
    // Notify background of the error
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', message: err.message });
    return;
  }

  // Pick best available MIME type
  const mimeType = getBestMime();

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    const durationSec = Math.round((Date.now() - startTs) / 1000);
    const blob        = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({
        type: 'RECORDING_DONE',
        dataUrl:     reader.result,
        mimeType:    blob.type,
        durationSec: durationSec
      });
    };
    reader.readAsDataURL(blob);

    // Clean up
    stream.getTracks().forEach(t => t.stop());
    stream        = null;
    audioChunks   = [];
  };

  mediaRecorder.onerror = (e) => {
    console.error('[offscreen] MediaRecorder error:', e.error);
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', message: e.error?.message || 'Unknown recording error' });
  };

  // Request data every 5 seconds to avoid losing everything on crash
  mediaRecorder.start(5000);
  console.log('[offscreen] Recording started, mimeType:', mediaRecorder.mimeType);
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    // Nothing to stop — send empty response
    chrome.runtime.sendMessage({ type: 'RECORDING_DONE', dataUrl: null, durationSec: 0 });
    return;
  }
  // onstop handler will send RECORDING_DONE
  mediaRecorder.stop();
}

function getBestMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}
