import { WebSocketServer, WebSocket } from 'ws'
import { sendCdpUp, sendCdpDown } from './swarm.js'

let wss = null
let clientSocket = null
let hostSocket = null

function startHostProxy(cdpPort, proxyPort, onCdpUp) {
  wss = new WebSocketServer({ port: proxyPort, host: '127.0.0.1' })

  wss.on('connection', (ws) => {
    clientSocket = ws
    hostSocket = new WebSocket(`ws://127.0.0.1:${cdpPort}`)

    hostSocket.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      sendCdpDown(buf)
    })

    hostSocket.on('error', () => {})
    hostSocket.on('close', () => { hostSocket = null })

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
        hostSocket.send(buf)
      }
    })

    ws.on('close', () => { clientSocket = null })
    ws.on('error', () => {})
  })

  wss.on('error', (err) => console.error('[cdp-proxy] host wss error:', err.message))
  console.log(`[cdp-proxy] host proxy listening on ws://127.0.0.1:${proxyPort}`)
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
    startHostProxy(cdpPort, proxyPort)
  } else {
    startClientProxy(proxyPort)
  }
}

function stopCdpProxy() {
  if (wss) { wss.close(); wss = null }
  if (hostSocket) { hostSocket.close(); hostSocket = null }
  clientSocket = null
}

export { startCdpProxy, stopCdpProxy, onSwarmCdpUp, onSwarmCdpDown }
