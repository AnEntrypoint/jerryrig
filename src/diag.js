import http from 'node:http'

const state = {
  audioFrames: 0,
  audioPeak: 0,
  lastAudioMs: 0,
  rendererLogs: [],
  rendererErrors: [],
  voiceStatus: 'disconnected',
  currentUrl: '',
  navGoCount: 0,
}

let _server = null

function startDiag(port = 9223) {
  _server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const body = JSON.stringify({
      ...state,
      audioActive: Date.now() - state.lastAudioMs < 3000,
      uptimeS: Math.round(process.uptime()),
    }, null, 2)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  })
  _server.on('error', (e) => console.warn('[diag] server error:', e.message))
  _server.listen(port, '127.0.0.1', () => {
    console.log(`[diag] http://127.0.0.1:${port}`)
  })
}

function recordAudio(peak) {
  state.audioFrames++
  state.audioPeak = peak
  state.lastAudioMs = Date.now()
}

function recordLog(msg) {
  state.rendererLogs.push({ t: Date.now(), msg })
  if (state.rendererLogs.length > 100) state.rendererLogs.shift()
  if (msg.includes('error') || msg.includes('failed') || msg.includes('Error')) {
    state.rendererErrors.push({ t: Date.now(), msg })
    if (state.rendererErrors.length > 50) state.rendererErrors.shift()
  }
}

function recordVoice(status) { state.voiceStatus = status }
function recordUrl(url) { state.currentUrl = url }
function recordNavGo() { state.navGoCount++ }

export { startDiag, recordAudio, recordLog, recordVoice, recordUrl, recordNavGo }
