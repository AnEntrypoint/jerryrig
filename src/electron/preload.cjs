const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000

let playCtx = null
let captureCtx = null
const nextPlayTime = {}

const WORKLET_CODE = `
  class PcmCapture extends AudioWorkletProcessor {
    process(inputs) {
      const inp = inputs[0]
      if (!inp || !inp[0]) return true
      const L = inp[0], R = inp[1] || inp[0]
      const out = new Float32Array(L.length * 2)
      for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
      this.port.postMessage(out.buffer, [out.buffer])
      return true
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

ipcRenderer.on('reset-capture', () => resetCapture())

function resetCapture() {
  if (captureCtx) {
    captureCtx.close().catch(() => {})
    captureCtx = null
  }
}

async function buildWorklet(ctx) {
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const worklet = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [CHANNELS],
  })
  worklet.port.onmessage = (e) => ipcRenderer.send('audio-pcm', e.data)
  return worklet
}

async function startCapture() {
  if (captureCtx) return

  captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
  await captureCtx.resume()

  const worklet = await buildWorklet(captureCtx).catch((err) => {
    ipcRenderer.send('log', '[capture] worklet failed: ' + err.message)
    captureCtx = null
    return null
  })
  if (!worklet || !captureCtx) return

  worklet.connect(captureCtx.destination)

  const tapped = new WeakSet()

  function tapElement(el) {
    if (tapped.has(el)) return
    tapped.add(el)
    try {
      captureCtx.createMediaElementSource(el).connect(worklet)
      ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '>')
    } catch (e) {
      ipcRenderer.send('log', '[capture] tap err: ' + e.message)
    }
  }

  document.querySelectorAll('audio,video').forEach(tapElement)

  new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue
        if (n.matches?.('audio,video')) tapElement(n)
        n.querySelectorAll?.('audio,video').forEach(tapElement)
      }
  }).observe(document.documentElement, { childList: true, subtree: true })

  ipcRenderer.send('log', '[capture] MediaElement strategy active, elements=' + document.querySelectorAll('audio,video').length)
}
