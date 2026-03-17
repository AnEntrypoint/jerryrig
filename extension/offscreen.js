let audioCtx = null
let processor = null
let ws = null
let wsUrl = null
let reconnectTimer = null
let active = false

function connectWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'
  ws.onclose = () => {
    ws = null
    if (active) reconnectTimer = setTimeout(connectWs, 2000)
  }
  ws.onerror = () => {}
}

function stopAudio() {
  active = false
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (processor) { try { processor.disconnect() } catch {} processor = null }
  if (audioCtx) { try { audioCtx.close() } catch {} audioCtx = null }
  if (ws) { try { ws.close() } catch {} ws = null }
}

async function startAudio(streamId, url) {
  wsUrl = url
  active = true
  connectWs()

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  })

  audioCtx = new AudioContext({ sampleRate: 48000 })
  const source = audioCtx.createMediaStreamSource(stream)
  processor = audioCtx.createScriptProcessor(4096, 2, 2)

  processor.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const left = e.inputBuffer.getChannelData(0)
    const right = e.inputBuffer.getChannelData(1)
    const interleaved = new Float32Array(left.length * 2)
    for (let i = 0; i < left.length; i++) {
      interleaved[i * 2] = left[i]
      interleaved[i * 2 + 1] = right[i]
    }
    ws.send(interleaved.buffer)
  }

  source.connect(processor)
  processor.connect(audioCtx.destination)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'OFFSCREEN_START') {
    startAudio(msg.streamId, msg.wsUrl).catch((e) => console.error('[offscreen]', e))
  }
  if (msg.type === 'OFFSCREEN_STOP') {
    stopAudio()
  }
})
