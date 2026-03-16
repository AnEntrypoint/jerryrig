import 'dotenv/config'
import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, joinDiscordVoice, subscribeToSpeaker, leaveVoice } from './bot/client.js'
import { createStreamer, joinAndStream, pushFrame, stopLive } from './bot/voice.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET_URL = process.env.TARGET_URL || 'https://example.com'
const BOT_TOKEN = process.env.BOT_TOKEN
const GUILD_ID = process.env.GUILD_ID
const CHANNEL_ID = process.env.CHANNEL_ID
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS || '24', 10)
const VIDEO_WIDTH = parseInt(process.env.VIDEO_WIDTH || '1280', 10)
const VIDEO_HEIGHT = parseInt(process.env.VIDEO_HEIGHT || '720', 10)
const VIDEO_BITRATE = parseInt(process.env.VIDEO_BITRATE || '3000', 10)
const WINDOW_TITLE = 'Discord Screen Bridge'

let mainWindow = null
let botClient = null

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))

function createWindow() {
  mainWindow = new BrowserWindow({
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    title: WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  mainWindow.loadURL(TARGET_URL).catch(() => {
    mainWindow.loadFile(path.join(__dirname, 'electron', 'error.html')).catch(() => {})
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function sendAudioToRenderer(userId, f32) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('audio-chunk', { userId, data: Array.from(f32) })
}

ipcMain.on('video-frame', (_, arrayBuffer) => {
  const buf = Buffer.from(arrayBuffer)
  pushFrame(buf)
})

async function findOwnWindowSource() {
  const sources = await desktopCapturer.getSources({ types: ['window'] })
  const own = sources.find((s) => s.name === WINDOW_TITLE)
  return own || sources[0]
}

async function startBot() {
  if (!BOT_TOKEN || !GUILD_ID || !CHANNEL_ID) {
    console.warn('[bot] BOT_TOKEN, GUILD_ID, or CHANNEL_ID not set — bot disabled')
    return
  }

  botClient = createClient()
  createStreamer(botClient)

  botClient.on('ready', async () => {
    console.log(`[bot] Logged in as ${botClient.user.tag}`)
    try {
      const { voiceReceiver } = joinDiscordVoice(botClient, GUILD_ID, CHANNEL_ID)
      console.log('[bot] Joined voice channel')

      voiceReceiver.speaking.on('start', (userId) => {
        subscribeToSpeaker(userId, sendAudioToRenderer)
      })

      await joinAndStream(GUILD_ID, CHANNEL_ID, VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS, VIDEO_BITRATE)
      console.log('[bot] Stream started')

      const source = await findOwnWindowSource()
      if (source && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-ready', {
          sourceId: source.id,
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
          fps: VIDEO_FPS,
        })
      }
    } catch (err) {
      console.error('[bot] Setup error:', err.message)
    }
  })

  botClient.on('error', (err) => console.error('[bot] Client error:', err.message))

  botClient.login(BOT_TOKEN).catch((err) => console.error('[bot] Login failed:', err.message))
}

app.on('ready', async () => {
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission))
  })

  createWindow()
  await startBot()
})

app.on('before-quit', () => {
  leaveVoice()
  stopLive()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})
