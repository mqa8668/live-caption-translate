# Product Spec: Live Caption & Translate

## Goal
A Chrome extension that helps people follow multilingual meetings in real time: live English captions, Vietnamese translation, short summaries, and session export.

## Target users
Team members, client-facing staff and webinar attendees who work in English and read Vietnamese more comfortably.

## Core features
- Live captions via the Web Speech API (microphone input).
- Vietnamese translation of each finished segment.
- 1-2 sentence Vietnamese summary and keywords per longer segment.
- Notes panel, glossary highlighting.
- Export as JSON, TXT and WebM audio. Clear session stops and clears in-memory captions and notes.

## Supported sites
Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Amazon Chime, Skype.

## Constraints
- Manifest V3; keys stored in `chrome.storage.local`.
- LLM providers: Gemini (primary), OpenRouter (fallback).
- Tell participants you are captioning or recording the call.

## Non-goals
- No automatic speaking or sending of messages.
- No server component; everything runs in the browser.
