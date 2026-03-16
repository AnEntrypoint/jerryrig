# Discord Voice Bridge — Architecture

## System Overview

Single Electron process that:
1. Opens a BrowserWindow loading TARGET_URL
2. Runs a discord.js v14 bot client (official bot token) in the main process
3. Joins a Discord voice channel via @discordjs/voice
4. Captures the Electron window audio via desktopCapturer loopback (in preload context)
5. Pipes raw PCM Float32 → interleaved s16le → prism-media Opus encoder → AudioResource → Discord voice
6. Receives Discord voice audio → VoiceReceiver Opus stream → prism-media Opus decoder → PCM Float32 → IPC → Web Audio API playback

## Audio Flow

### Outbound (Electron → Discord)
1. Electron window loads TARGET_URL
2. On `did-finish-load`, main process calls `desktopCapturer.getSources` to find the window source ID
3. Sends `start-capture` IPC to renderer with the source ID
4. Preload uses `getUserMedia` with `chromeMediaSource: 'desktop'` + the source ID to get loopback audio stream
5. ScriptProcessorNode taps audio at FRAME_SIZE=960 samples, interleaves stereo channels to Float32
6. Sends `audio-pcm` IPC to main with the Float32Array buffer
7. Main process `ipcMain.on('audio-pcm')` calls `pushAudioFrame(f32)`
8. `pushAudioFrame` converts f32 to s16le, writes to PassThrough stream
9. PassThrough → prism opus Encoder → createAudioResource(StreamType.Opus) → AudioPlayer.play()

### Inbound (Discord → Electron)
1. VoiceReceiver detects speaking via `speaking` event
2. `subscribeToSpeaker` subscribes to user's Opus stream
3. prism opus Decoder converts Opus → s16le PCM Buffer
4. Decoded buffer converted to Float32Array (/ 32768)
5. `sendAudioToRenderer` sends `audio-chunk` IPC to renderer
6. Preload AudioContext schedules buffer playback with jitter buffer

## Key Architecture Decisions

### Bot runs in Electron main process
No separate bot process. Eliminates socket/IPC complexity for audio. Bot and Electron share the same Node.js event loop.

### Official bot token (discord.js v14)
Uses `discord.js` v14 with `GatewayIntentBits.Guilds` and `GatewayIntentBits.GuildVoiceStates`. No selfbot. Bot must have CONNECT + SPEAK permissions in the target voice channel.

### Audio capture via desktopCapturer loopback
The preload script uses `getUserMedia` with `chromeMediaSource: 'desktop'` and the window's source ID. This captures both audio and a minimal video stream (1x1 px) to get the audio loopback. The video track is unused; only the audio track is processed.

### PCM pipeline uses ScriptProcessorNode
ScriptProcessorNode (deprecated but universally available in Electron/Chromium) is used in the preload to tap the audio at exactly 960 samples/frame (one Opus frame). This avoids AudioWorklet complexity and works reliably in the preload isolated world.

### preload.js must be .cjs
With `"type": "module"` in package.json, Electron preload scripts must use `.cjs` extension. The main process uses ESM.

### Voice encryption: tweetnacl
@discordjs/voice requires a sodium implementation. `tweetnacl` is used (pure JS, no native build required on Windows). `libsodium-wrappers` also present as fallback.

## Gotchas

### Guild/channel cache on ready
With discord.js v14, the guild and channel cache may not be populated immediately on `ready`. `joinDiscordVoice` explicitly calls `guilds.fetch()` and `guild.channels.fetch()` if the cache misses.

### AudioPlayer idle after silence
When no audio frames arrive, the AudioPlayer goes idle (resource stream ends or stalls). The `AudioPlayerStatus.Idle` handler calls `_startPlayback()` to reset the PassThrough + encoder pipeline and continue playing.

### AudioContext in preload isolated world
With `contextIsolation: true`, the preload runs in a separate world but has access to Web Audio API. Inbound audio playback goes to system speakers regardless of what page is loaded.

### desktopCapturer sourceId for loopback
The source ID must match the exact window. `desktopCapturer` is called in main process (not renderer) and the ID is forwarded to the renderer via IPC. Electron requires `display-capture` permission to be granted (set in `setPermissionRequestHandler`).

## agent-browser (CDP)

The Electron window exposes Chrome DevTools Protocol on `127.0.0.1:CDP_PORT` (default 9222).

Connect with [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser):

```
agent-browser connect 9222
agent-browser snapshot
agent-browser screenshot
agent-browser --cdp 9222 open https://example.com
```

The port is set via `app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT)` before `app ready`. Change it with `CDP_PORT=9223` in `.env`.

No custom HTTP server is needed — Electron's built-in CDP server is the interface agent-browser uses.

## File Map

- `src/main.js` — Electron main entry, wires all modules
- `src/bot/client.js` — discord.js v14 login, @discordjs/voice join, Opus decode, audio IPC send
- `src/bot/voice.js` — PCM PassThrough → Opus encoder → AudioResource → AudioPlayer
- `src/electron/preload.cjs` — Audio playback (Web Audio) + loopback capture (desktopCapturer)
- `src/electron/error.html` — Fallback page if TARGET_URL fails
- `.env.example` — All configurable variables
