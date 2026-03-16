const { ipcRenderer } = require('electron')
require('./spoof.cjs')

const SAMPLE_RATE = 48000

let captureCtx = null
let captureGen = 0
let workletNode = null

window._gmNav = {
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  go: (url) => ipcRenderer.send('nav-go', url),
}

ipcRenderer.on('start-capture', () => startCapture())
ipcRenderer.on('reset-capture', () => {
  captureGen++
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
  workletNode = null
})

async function buildCaptureGraph() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
  captureCtx = ctx
  ctx.resume().catch(() => {})

  const workletCode = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const L = input[0], R = input[1] || input[0]
      const out = new Float32Array(L.length * 2)
      for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
      this.port.postMessage(out.buffer, [out.buffer])
    }
    return true
  }
}
registerProcessor('capture-processor', CaptureProcessor)
`
  const blob = new Blob([workletCode], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)

  const node = new AudioWorkletNode(ctx, 'capture-processor')
  workletNode = node
  let _count = 0
  node.port.onmessage = (e) => {
    _count++
    if (_count <= 3 || _count % 500 === 0) ipcRenderer.send('log', '[capture] frame #' + _count)
    ipcRenderer.send('audio-pcm', e.data)
  }

  const silencer = ctx.createGain()
  silencer.gain.value = 0
  node.connect(silencer)
  silencer.connect(ctx.destination)

  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  oscGain.gain.value = 0
  osc.connect(oscGain)
  oscGain.connect(node)
  osc.start()

  return ctx
}

function connectMediaEl(el) {
  if (!captureCtx || captureCtx.state === 'closed') return
  if (el._gmCaptured) return
  el._gmCaptured = true
  try {
    const src = captureCtx.createMediaElementSource(el)
    src.connect(workletNode)
    ipcRenderer.send('log', '[capture] media element connected: ' + (el.src || el.currentSrc || 'unknown').slice(0, 80))
  } catch (e) {
    ipcRenderer.send('log', '[capture] media element connect failed: ' + e.message)
  }
}

function patchAudioNodeConnect(ctx) {
  const _orig = AudioNode.prototype.connect
  const dest = ctx.createMediaStreamDestination()
  AudioNode.prototype.connect = function(target, outIdx, inIdx) {
    if (target instanceof AudioDestinationNode && target === ctx.destination) {
      const r = outIdx !== undefined ? _orig.call(this, target, outIdx, inIdx !== undefined ? inIdx : 0) : _orig.call(this, target)
      _orig.call(this, workletNode, outIdx !== undefined ? outIdx : 0)
      return r
    }
    return outIdx !== undefined ? _orig.call(this, target, outIdx, inIdx !== undefined ? inIdx : 0) : _orig.call(this, target)
  }
}

function scanMediaElements() {
  document.querySelectorAll('video, audio').forEach(connectMediaEl)
}

function observeMediaElements() {
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches && node.matches('video, audio')) connectMediaEl(node)
        node.querySelectorAll && node.querySelectorAll('video, audio').forEach(connectMediaEl)
      }
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: true })
}

async function startCapture() {
  captureGen++
  const gen = captureGen

  await new Promise(r => setTimeout(r, 500))
  if (captureGen !== gen) return
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null; workletNode = null }

  await buildCaptureGraph()
  patchAudioNodeConnect(captureCtx)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (captureGen === gen) { scanMediaElements(); observeMediaElements() }
    })
  } else {
    scanMediaElements()
    observeMediaElements()
  }

  ipcRenderer.send('log', '[capture] active (web-audio + media-element intercept)')
}
