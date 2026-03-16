const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000

let playCtx = null
let captureCtx = null
let mutationObserver = null
const nextPlayTime = {}
const tappedElements = new WeakSet()

const WORKLET_CODE = `
  class PcmCapture extends AudioWorkletProcessor {
    process(inputs) {
      const inp = inputs[0]
      if (!inp || !inp[0]) return true
      const L = inp[0], R = inp[1] || inp[0]
      const out = new Float32Array(L.length * 2)
      for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
      this.port.postMessage(out.buffer, [out.buffer])
      return false
    }
  }
  registerProcessor('pcm-capture', PcmCapture)
`

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
  resetCapture()
  startCapture()
})

ipcRenderer.on('reset-capture', () => {
  resetCapture()
})

function resetCapture() {
  if (mutationObserver) {
    mutationObserver.disconnect()
    mutationObserver = null
  }
  if (captureCtx) {
    captureCtx.close().catch(() => {})
    captureCtx = null
  }
}

function tapElement(el, worklet) {
  if (tappedElements.has(el)) return
  tappedElements.add(el)
  try {
    const src = captureCtx.createMediaElementSource(el)
    src.connect(worklet)
    ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '> src=' + (el.src || el.currentSrc || '').slice(0, 60))
  } catch (err) {
    ipcRenderer.send('log', '[capture] tap failed: ' + err.message)
  }
}

function startCapture() {
  if (captureCtx) return

  captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
  captureCtx.resume().catch(() => {})

  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const workletUrl = URL.createObjectURL(blob)

  captureCtx.audioWorklet.addModule(workletUrl).then(() => {
    URL.revokeObjectURL(workletUrl)

    if (!captureCtx) return

    const worklet = new AudioWorkletNode(captureCtx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [CHANNELS],
    })
    worklet.port.onmessage = (e) => {
      ipcRenderer.send('audio-pcm', e.data)
    }
    document.querySelectorAll('audio, video').forEach((el) => tapElement(el, worklet))

    mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches('audio, video')) tapElement(node, worklet)
          node.querySelectorAll && node.querySelectorAll('audio, video').forEach((el) => tapElement(el, worklet))
        }
      }
    })
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true })

    ipcRenderer.send('log', '[capture] started, ctx=' + captureCtx.state + ' elements=' + document.querySelectorAll('audio,video').length)
  }).catch((err) => {
    ipcRenderer.send('log', '[capture] addModule failed: ' + err.message)
    captureCtx = null
  })
}
