# Discord Screen Bridge — Architecture

## System Overview

Single Electron process that:
1. Opens a BrowserWindow loading TARGET_URL
2. Runs a discord.js-selfbot-v13 client in the main process
3. Joins a Discord voice channel via the Streamer class (discord-video-stream)
4. Captures the Electron window via desktopCapturer (in preload context)
5. Pipes raw RGBA frames → ffmpeg → NUT stream → playStream (Go Live)
6. Receives Discord voice audio → Opus decode → PCM Float32 → IPC → Web Audio API

## Key Architecture Decisions

### Bot runs in Electron main process
No separate bot process. Eliminates socket/IPC complexity for audio. Bot and Electron share the same Node.js event loop.

### Selfbot required for screen share
Official Discord bot API does not support Go Live / screen share. Only selfbot (user token) + discord.js-selfbot-v13 + @dank074/discord-video-stream enables this.

### Audio routing: IPC → Web Audio API
Discord voice receive → @discordjs/voice VoiceReceiver → prism-media OpusDecoder → PCM Int16 → converted Float32 → ipcMain → webContents.send → preload.cjs AudioContext → speakers. No virtual audio cable needed.

### Screen capture: desktopCapturer in preload
The preload script (CJS, runs in renderer process) uses `navigator.mediaDevices.getUserMedia` with `chromeMediaSource: 'desktop'`. Raw RGBA frames extracted via OffscreenCanvas getImageData and sent to main via IPC.

### Video encoding: standalone ffmpeg spawn
@dank074/discord-video-stream v6 uses LibavDemuxer (WASM) which cannot handle raw RGBA input. We bypass `prepareStream` and spawn ffmpeg directly with `-f rawvideo -pix_fmt rgba` input piped from the frame stream, output NUT format piped to `playStream`.

### preload.js must be .cjs
With `"type": "module"` in package.json, Electron preload scripts must use `.cjs` extension or CommonJS format. The main process uses ESM.

## Gotchas

### OffscreenCanvas in preload
`OffscreenCanvas` is available in Electron's preload context (Chromium renderer). If unavailable, fall back to regular Canvas in a hidden div.

### AudioContext in preload isolated world
With `contextIsolation: true`, the preload runs in a separate world but still has access to Web Audio API. Audio output goes to system speakers regardless of what page is loaded.

### voiceAdapterCreator on selfbot guild
discord.js-selfbot-v13 Guild objects have `voiceAdapterCreator` compatible with @discordjs/voice. This is required for joinVoiceChannel.

### discord-video-stream v6 API change
v6 removed fluent-ffmpeg from prepareStream and switched to LibavDemuxer (node-av WASM). `prepareStream` still works for URL/file inputs but raw Readable streams must produce a recognizable container format (NUT, matroska). Our solution: spawn ffmpeg manually and pipe NUT output to playStream.

### libsodium vs sodium-native
@discordjs/voice prefers sodium-native (faster) but falls back to libsodium-wrappers. We install libsodium-wrappers to avoid Windows native build issues.

### Electron window must stay visible
desktopCapturer will return blank frames if the window is minimized. Keep the window visible during streaming.

## File Map

- `src/main.js` — Electron main entry, wires all modules
- `src/bot/client.js` — selfbot login, @discordjs/voice join, Opus decode, audio IPC send
- `src/bot/voice.js` — Streamer, ffmpeg spawn, playStream
- `src/electron/preload.cjs` — Audio playback (Web Audio) + screen capture (desktopCapturer)
- `src/electron/error.html` — Fallback page if TARGET_URL fails
- `.env.example` — All configurable variables
