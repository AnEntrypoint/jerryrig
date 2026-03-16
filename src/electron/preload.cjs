const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000

let playCtx = null
let captureCtx = null
const nextPlayTime = {}

function getPlayCtx() {
  if (!playCtx) playCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  if (playCtx.state === 'suspended') playCtx.resume()
  return playCtx
}

contextBridge.exposeInMainWorld('_gmNav', {
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  go: (url) => ipcRenderer.send('nav-go', url),
})

ipcRenderer.on('audio-chunk', (_, { userId, data }) => {
  const ctx = getPlayCtx()
  const f32 = new Float32Array(data)
  const samplesPerCh = Math.floor(f32.length / CHANNELS)
  if (!samplesPerCh) return
  const buf = ctx.createBuffer(CHANNELS, samplesPerCh, SAMPLE_RATE)
  for (let ch = 0; ch < CHANNELS; ch++) {
    const cd = buf.getChannelData(ch)
    for (let i = 0; i < samplesPerCh; i++) cd[i] = f32[i * CHANNELS + ch]
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  const now = ctx.currentTime
  if (!nextPlayTime[userId] || nextPlayTime[userId] < now) nextPlayTime[userId] = now + 0.06
  src.start(nextPlayTime[userId])
  nextPlayTime[userId] += buf.duration
})

ipcRenderer.on('start-capture', () => {
  startCapture()
})

ipcRenderer.on('reset-capture', () => {
  if (captureCtx) {
    captureCtx.close().catch(() => {})
    captureCtx = null
  }
})

function startCapture() {
  if (captureCtx) return

  const video = document.querySelector('video')
  if (!video) {
    ipcRenderer.send('log', '[capture] No video element found, retrying in 1s')
    setTimeout(startCapture, 1000)
    return
  }
  ipcRenderer.send('log', '[capture] video found, readyState=' + video.readyState + ' paused=' + video.paused + ' src=' + video.src.slice(0, 60))

  captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
  captureCtx.resume().catch(() => {})

  let source
  try {
    source = captureCtx.createMediaElementSource(video)
  } catch (err) {
    ipcRenderer.send('log', '[capture] createMediaElementSource failed: ' + err.message)
    captureCtx = null
    return
  }

  const workletCode = `
    class PcmCapture extends AudioWorkletProcessor {
      process(inputs) {
        const inp = inputs[0]
        if (!inp || !inp[0]) return true
        const L = inp[0], R = inp[1] || inp[0]
        const out = new Float32Array(L.length * ${CHANNELS})
        for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
        this.port.postMessage(out.buffer, [out.buffer])
        return true
      }
    }
    registerProcessor('pcm-capture', PcmCapture)
  `
  const blob = new Blob([workletCode], { type: 'application/javascript' })
  const workletUrl = URL.createObjectURL(blob)

  captureCtx.audioWorklet.addModule(workletUrl).then(() => {
    URL.revokeObjectURL(workletUrl)
    const worklet = new AudioWorkletNode(captureCtx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    worklet.port.onmessage = (e) => {
      ipcRenderer.send('audio-pcm', e.data)
    }
    source.connect(worklet)
    worklet.connect(captureCtx.destination)
    ipcRenderer.send('log', '[capture] AudioWorklet capture started, ctx state=' + captureCtx.state)
  }).catch((err) => {
    ipcRenderer.send('log', '[capture] AudioWorklet addModule failed: ' + err.message)
  })
}
