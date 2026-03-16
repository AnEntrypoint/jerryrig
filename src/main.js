import 'dotenv/config'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient, joinDiscordVoice, subscribeToSpeaker, leaveVoice } from './bot/client.js'
import { initVoicePlayer, pushAudioFrame, stopAudio } from './bot/voice.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET_URL = process.env.TARGET_URL || 'https://example.com'
const CDP_PORT = process.env.CDP_PORT || '9222'

app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT)
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const GUILD_ID = process.env.GUILD_ID
const CHANNEL_ID = process.env.CHANNEL_ID
const WINDOW_TITLE = 'Discord Voice Bridge'

const NAVBAR_CODE = fs.readFileSync(path.join(__dirname, 'electron', 'navbar.cjs'), 'utf8')

let mainWindow = null
let botClient = null

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))

function injectNavbar(wc) {
  wc.executeJavaScript(NAVBAR_CODE).catch((err) => {
    console.error('[main] navbar inject failed:', err.message)
  })
}

function createWindow() {
  session.defaultSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      partition: 'persist:main',
    },
  })

  mainWindow.loadURL(TARGET_URL).catch(() => {
    mainWindow.loadFile(path.join(__dirname, 'electron', 'error.html')).catch(() => {})
  })

  mainWindow.webContents.on('did-start-navigation', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reset-capture')
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load, injecting navbar + start-capture')
    if (mainWindow && !mainWindow.isDestroyed()) {
      injectNavbar(mainWindow.webContents)
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

ipcMain.on('nav-back', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.goBack()
})

ipcMain.on('nav-forward', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.goForward()
})

ipcMain.on('nav-go', (_, url) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.loadURL(url).catch((err) => {
      console.error('[main] nav-go loadURL failed:', err.message)
    })
  }
})

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

      // Inbound audio path disabled to prevent feedback loop — bot sends only
      // voiceReceiver.speaking.on('start', (userId) => {
      //   subscribeToSpeaker(userId, sendAudioToRenderer)
      // })

      console.log('[bot] Audio bridge ready — outbound: Electron audio -> Discord')
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
