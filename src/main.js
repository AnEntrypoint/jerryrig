import 'dotenv/config'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, joinDiscordVoice, subscribeToSpeaker, leaveVoice } from './bot/client.js'
import { initVoicePlayer, pushAudioFrame, stopAudio } from './bot/voice.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET_URL = process.env.TARGET_URL || 'https://example.com'
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const GUILD_ID = process.env.GUILD_ID
const CHANNEL_ID = process.env.CHANNEL_ID
const WINDOW_TITLE = 'Discord Voice Bridge'

let mainWindow = null
let botClient = null

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
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

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load, sending start-capture')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('start-capture')
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function sendAudioToRenderer(userId, f32) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('audio-chunk', { userId, data: Array.from(f32) })
}

ipcMain.on('log', (_, msg) => console.log('[renderer]', msg))

let _audioFrameCount = 0
ipcMain.on('audio-pcm', (_, arrayBuffer) => {
  const buf = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer)
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  _audioFrameCount++
  if (_audioFrameCount <= 5 || _audioFrameCount % 500 === 0) {
    console.log(`[main] audio-pcm frame #${_audioFrameCount}, samples=${f32.length}, peak=${Math.max(...f32).toFixed(4)}`)
  }
  pushAudioFrame(f32)
})

async function startBot() {
  if (!BOT_TOKEN || !GUILD_ID || !CHANNEL_ID) {
    console.warn('[bot] BOT_TOKEN, GUILD_ID, or CHANNEL_ID not set — bot disabled')
    return
  }

  botClient = createClient()

  botClient.on('ready', async () => {
    console.log(`[bot] Logged in as ${botClient.user.tag}`)
    try {
      const { voiceConnection, voiceReceiver } = await joinDiscordVoice(botClient, GUILD_ID, CHANNEL_ID)
      console.log('[bot] Joined voice channel')

      initVoicePlayer(voiceConnection)

      voiceReceiver.speaking.on('start', (userId) => {
        subscribeToSpeaker(userId, sendAudioToRenderer)
      })

      console.log('[bot] Audio bridge ready — outbound: Electron audio → Discord, inbound: Discord → Electron')
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
  stopAudio()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})
