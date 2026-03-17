import { WebSocketServer, WebSocket } from 'ws'
import { sendCdpUp, sendCdpDown } from './swarm.js'

let wss = null
let clientSocket = null
let hostSocket = null
let _cdpPort = null
let _reconnecting = false

async function _fetchDebuggerUrl(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
  const json = await res.json()
  return json.webSocketDebuggerUrl.replace('ws://localhost', 'ws://127.0.0.1')
}

async function _connectHostSocket(cdpPort) {
  if (_reconnecting) return
  _reconnecting = true
  let url
  for (let i = 0; i < 20; i++) {
    try {
      url = await _fetchDebuggerUrl(cdpPort)
      break
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  _reconnecting = false
  if (!url) { console.error('[cdp-proxy] could not get debugger URL'); return }
  hostSocket = new WebSocket(url)
  hostSocket.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    sendCdpDown(buf)
  })
  hostSocket.on('error', () => {})
  hostSocket.on('close', () => {
    hostSocket = null
    if (_cdpPort) setTimeout(() => _connectHostSocket(_cdpPort), 2000)
  })
  hostSocket.on('open', () => console.log('[cdp-proxy] connected to CDP server'))
}

function startHostProxy(cdpPort) {
  _cdpPort = cdpPort
  _connectHostSocket(cdpPort)
}

function startClientProxy(proxyPort) {
  wss = new WebSocketServer({ port: proxyPort, host: '127.0.0.1' })
  wss.on('connection', (ws) => {
    clientSocket = ws
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      sendCdpUp(buf)
    })
    ws.on('close', () => { clientSocket = null })
    ws.on('error', () => {})
  })
  wss.on('error', (err) => console.error('[cdp-proxy] client wss error:', err.message))
  console.log(`[cdp-proxy] client proxy listening on ws://127.0.0.1:${proxyPort}`)
}

function onSwarmCdpUp(buf) {
  if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
    hostSocket.send(buf)
  }
}

function onSwarmCdpDown(buf) {
  if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
    clientSocket.send(buf)
  }
}

function startCdpProxy(role, cdpPort, proxyPort) {
  if (role === 'host') {
    startHostProxy(cdpPort)
  } else {
    startClientProxy(proxyPort)
  }
}

function stopCdpProxy() {
  _cdpPort = null
  if (wss) { wss.close(); wss = null }
  if (hostSocket) { hostSocket.close(); hostSocket = null }
  clientSocket = null
}

export { startCdpProxy, stopCdpProxy, onSwarmCdpUp, onSwarmCdpDown }
