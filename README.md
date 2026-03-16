# Discord Screen Bridge

Electron app that joins a Discord voice channel, screen shares its window as a Go Live stream, and routes Discord voice audio back into the web page playing in the window.

## WARNING

This project uses the selfbot API (a regular Discord user account token). Using automation on your account violates Discord's Terms of Service and may result in a permanent ban. Use at your own risk, on a dedicated/test account.

## How It Works

1. Electron opens a BrowserWindow loading your TARGET_URL
2. A discord.js selfbot client logs in and joins your voice channel
3. The window is captured via desktopCapturer, encoded to H264 via ffmpeg, and streamed as Go Live
4. Other users' voice audio is received, decoded from Opus to PCM, and played through Web Audio API in the window

## Prerequisites

- Node.js 18 or later
- ffmpeg on PATH (or install via `npm install ffmpeg-static` — already included)
- A Discord account token (user token, not bot token)
- A Discord server where you have permission to go live in a voice channel

## Installation

```
git clone <repo>
cd screens
npm install --legacy-peer-deps
cp .env.example .env
```

Edit `.env` with your values.

## Getting Your Discord Token

1. Open Discord in a browser (discord.com/app)
2. Open DevTools (F12) > Console tab
3. Paste: `window.webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]);m.filter(m=>m?.exports?.default?.getToken).map(m=>m.exports.default.getToken())`
4. Copy the token value

Keep this token secret. Never share it.

## Configuration (.env)

| Variable | Description | Default |
|---|---|---|
| BOT_TOKEN | Discord user account token | required |
| TARGET_URL | URL to load in the Electron window | https://example.com |
| GUILD_ID | Discord server ID | required |
| CHANNEL_ID | Voice channel ID to join | required |
| VIDEO_WIDTH | Stream width in pixels | 1280 |
| VIDEO_HEIGHT | Stream height in pixels | 720 |
| VIDEO_FPS | Stream frame rate | 24 |
| VIDEO_BITRATE | Stream bitrate in kbps | 3000 |

To get Guild ID and Channel ID: enable Developer Mode in Discord settings, then right-click the server icon or channel name and select "Copy ID".

## Running

```
npm start
```

The Electron window will open. The bot will log in, join the voice channel, and start the Go Live stream automatically. Other members in the voice channel will see the screen share and can join the stream.

## Notes

- The Electron window must remain visible (not minimized) for screen capture to work
- Audio from Discord voice (other users speaking) plays through the Electron window's audio context
- To stop, close the Electron window — the bot will leave the voice channel automatically
