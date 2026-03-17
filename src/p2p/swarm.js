import Hyperswarm from 'hyperswarm'
import { createHash } from 'node:crypto'

const MSG = { AUDIO: 1, FRAME: 2, CDP_UP: 3, CDP_DOWN: 4, INPUT: 5 }

let swarm = null
let peer = null
let recvBuf = Buffer.alloc(0)
let callbacks = {}

function _hashTopic(str) {
  return createHash('sha256').update(str).digest()
}

function _encode(type, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const out = Buffer.allocUnsafe(8 + buf.length)
  out.writeUInt32LE(type, 0)
  out.writeUInt32LE(buf.length, 4)
  buf.copy(out, 8)
  return out
}

function _send(type, payload) {
  if (!peer || peer.destroyed) return
  try {
    peer.write(_encode(type, payload))
  } catch {}
}

function _processRecvBuf() {
  while (recvBuf.length >= 8) {
    const type = recvBuf.readUInt32LE(0)
    const len = recvBuf.readUInt32LE(4)
    if (recvBuf.length < 8 + len) break
    const payload = recvBuf.slice(8, 8 + len)
    recvBuf = recvBuf.slice(8 + len)
    _dispatch(type, payload)
  }
}

function _dispatch(type, payload) {
  if (type === MSG.AUDIO && callbacks.onAudio) {
    const f32 = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4)
    callbacks.onAudio(f32)
  } else if (type === MSG.FRAME && callbacks.onFrame) {
    callbacks.onFrame(payload)
  } else if (type === MSG.CDP_UP && callbacks.onCdpUp) {
    callbacks.onCdpUp(payload)
  } else if (type === MSG.CDP_DOWN && callbacks.onCdpDown) {
    callbacks.onCdpDown(payload)
  } else if (type === MSG.INPUT && callbacks.onInput) {
    try { callbacks.onInput(JSON.parse(payload.toString())) } catch {}
  }
}

function _attachPeer(conn) {
  peer = conn
  recvBuf = Buffer.alloc(0)
  conn.on('data', (chunk) => {
    recvBuf = Buffer.concat([recvBuf, chunk])
    _processRecvBuf()
  })
  conn.on('error', () => {})
  conn.on('close', () => {
    peer = null
    if (callbacks.onDisconnect) callbacks.onDisconnect()
  })
  if (callbacks.onConnect) callbacks.onConnect()
}

async function startSwarm(topicStr, role, cbs) {
  callbacks = cbs || {}
  swarm = new Hyperswarm()
  const topic = _hashTopic(topicStr)

  swarm.on('connection', (conn) => {
    if (peer && !peer.destroyed) {
      conn.destroy()
      return
    }
    _attachPeer(conn)
  })

  swarm.on('error', (err) => console.error('[swarm] error:', err.message))

  await swarm.join(topic, { client: true, server: true }).flushed()
  console.log(`[swarm] joined topic as ${role}`)
}

function destroySwarm() {
  if (swarm) {
    swarm.destroy().catch(() => {})
    swarm = null
    peer = null
  }
}

function sendAudio(f32) {
  _send(MSG.AUDIO, Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength))
}

function sendFrame(jpegBuf) {
  _send(MSG.FRAME, jpegBuf)
}

function sendInput(eventObj) {
  _send(MSG.INPUT, Buffer.from(JSON.stringify(eventObj)))
}

function sendCdpUp(buf) {
  _send(MSG.CDP_UP, buf)
}

function sendCdpDown(buf) {
  _send(MSG.CDP_DOWN, buf)
}

export { startSwarm, destroySwarm, sendAudio, sendFrame, sendInput, sendCdpUp, sendCdpDown }
