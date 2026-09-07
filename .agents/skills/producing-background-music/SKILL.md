---
name: producing-background-music
description: Use when asked to create background music, generate a song with Google Flow Music, log into flowmusic.app, or download AI-generated audio for a YouTube video.
---

# Producing Background Music

## Overview

Drive the user's logged-in Flow Music session (Lyria-powered, prompt-based) through a dedicated non-automated Chrome profile, then extract rendered audio from the app's own API responses.

## When to Use

- User wants background music, a jingle, or a loop for a video
- User asks to use Flow Music / flowmusic.app for generation
- Symptoms: Google sign-in shows "This browser or app may not be secure"

When NOT to use: plain TTS/voiceover work, or when the user supplies their own audio.

## Core Pattern

Google OAuth blocks automated browsers but trusts real ones; the site's audio has no `<audio>` tags, so read the API responses instead of scraping the DOM.

## Implementation

### 1. Launch the dedicated profile (never automate login)

If the profile is lost, run [scripts/setup-flowmusic-profile.ps1](scripts/setup-flowmusic-profile.ps1) — it recreates the profile dir, launches Chrome, and verifies the CDP endpoint:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-flowmusic-profile.ps1
```

Equivalent manual commands:

```powershell
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:TEMP\chrome-profile-flowmusic","https://www.flowmusic.app/"
curl.exe -s http://127.0.0.1:9222/json/version   # must return Browser/Protocol-Version
```

Log into Google **manually** in that window, once — the session persists. Never point remote debugging at the everyday Chrome profile (Chrome 136+ ignores the flag).

### 2. Generate via the Producer chat

The composer is `textarea[placeholder="Ask Producer..."]` plus Send. Prompt with genre, instruments, tempo/BPM, key, vocal policy (`no vocals` for beds), and mix notes. The model returns 2 versions in about a minute; track length is model-chosen, so verify it.

### 3. Extract audio URLs from API responses

Playback uses WebAudio (no media elements or stable media URLs in the DOM). Reload over CDP with `Network.enable`, then `Network.getResponseBody` on:

| Endpoint | Gives you |
|---|---|
| `GET __api/audio-create-song-status/<op_id>` | `clip_id` for the operation |
| `GET __api/clips` | `clips.<clip_id>` record with direct file URLs |

The cover-art asset id equals the operation id. Audio files follow this pattern (both formats exist per clip):

```text
https://storage.googleapis.com/producer-app-public/clips/<clip_id>.wav
https://storage.googleapis.com/producer-app-public/clips/<clip_id>.m4a
```

Confirm `[Instrumental]` and `allow_public_use` in the clip record before publishing to YouTube.

### 4. Download and trim

```powershell
curl.exe -L -o "$env:USERPROFILE\Downloads\<Title>.wav" "<clip wav url>"
ffmpeg -y -v error -i "$env:USERPROFILE\Downloads\<Title>.wav" -t 30 `
  -af "afade=t=out:st=27:d=3" "$env:USERPROFILE\Downloads\<Title> - 30s.mp3"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "<file>"
```

## Common Mistakes

- Automating the Google sign-in form — blocked with "browser or app may not be secure" before the password step. Manual login in the dedicated profile is the fix, not stealth flags.
- Clicking "Download video" expecting audio — it opens a music-video template picker, not an audio export.
- Trusting the "Song link copied" toast from automation — the page clipboard often never reaches the OS clipboard; re-derive links from `__api/clips`.
- Calling `__api/*` with bare fetch — endpoints return `Unauthorized`; capture the app's own responses over CDP instead.
