import dotenv from 'dotenv'
import path from 'node:path'
dotenv.config({ path: path.join(path.dirname(process.execPath), '.env') })
dotenv.config()
import { app, BrowserWindow, ipcMain, session } from 'electron'
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

let mainWindow = null
let botClient = null

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CHROME_VERSION = '126'

function createWindow() {
  session.defaultSession.setUserAgent(CHROME_UA)

  const mainSession = session.fromPartition('persist:main')
  mainSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })
  mainSession.setPermissionCheckHandler(() => true)
  mainSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders
    if (!headers) { callback({}); return }
    delete headers['content-security-policy']
    delete headers['Content-Security-Policy']
    callback({ responseHeaders: headers })
  })
  mainSession.setUserAgent(CHROME_UA)
  mainSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders
    h['User-Agent'] = CHROME_UA
    h['sec-ch-ua'] = `"Not/A)Brand";v="8", "Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`
    h['sec-ch-ua-mobile'] = '?0'
    h['sec-ch-ua-platform'] = '"Windows"'
    delete h['X-Powered-By']
    callback({ requestHeaders: h })
  })

  const preloadDir = path.join(__dirname, 'electron').replace(/\\/g, '/')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true,
    title: WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      additionalArguments: ['--preload-dir=' + preloadDir],
      contextIsolation: false,
      autoplayPolicy: 'no-user-gesture-required',
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      partition: 'persist:main',
    },
  })

  mainWindow.show()
  mainWindow.focus()

  mainWindow.loadURL(TARGET_URL).catch(() => {
    mainWindow.loadFile(path.join(__dirname, 'electron', 'error.html')).catch(() => {})
  })

  mainWindow.webContents.setAudioMuted(true)

  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[main] did-finish-load, sending start-capture')
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('start-capture')
  })

  mainWindow.webContents.on('console-message', (_, level, message) => {
    if (level >= 2) console.error('[renderer-console]', message)
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

  let _connecting = false
  const connectVoice = async () => {
    if (_connecting) return
    _connecting = true
    try {
      const { voiceConnection } = await joinDiscordVoice(botClient, GUILD_ID, CHANNEL_ID)
      console.log('[bot] Joined voice channel')
      initVoicePlayer(voiceConnection)
      console.log('[bot] Audio bridge ready')
      voiceConnection.once('stateChange', (o, n) => {
        if (n.status === 'destroyed') {
          console.log('[bot] Voice connection destroyed, reconnecting in 15s')
          _connecting = false
          setTimeout(connectVoice, 15000)
        }
      })
    } catch (err) {
      console.error('[bot] Join error:', err.message, '— retrying in 15s')
      _connecting = false
      setTimeout(connectVoice, 15000)
    }
  }

  botClient.on('ready', async () => {
    console.log(`[bot] Logged in as ${botClient.user.tag}`)
    await connectVoice()
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
