const { ipcRenderer } = require('electron')

const SAMPLE_RATE = 48000

let captureCtx = null
let captureGen = 0
let scriptNode = null

window._gmNav = {
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  go: (url) => ipcRenderer.send('nav-go', url),
}

ipcRenderer.on('start-capture', () => startCapture())
ipcRenderer.on('reset-capture', () => {
  captureGen++
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
  scriptNode = null
})

function buildCaptureGraph() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
  captureCtx = ctx
  ctx.resume().catch(() => {})

  const node = ctx.createScriptProcessor(4096, 2, 2)
  scriptNode = node
  let _count = 0
  node.onaudioprocess = (e) => {
    const L = e.inputBuffer.getChannelData(0)
    const R = e.inputBuffer.getChannelData(1)
    const out = new Float32Array(L.length * 2)
    for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
    _count++
    if (_count <= 3 || _count % 500 === 0) ipcRenderer.send('log', '[capture] frame #' + _count)
    ipcRenderer.send('audio-pcm', out.buffer)
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
    src.connect(scriptNode)
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
      _orig.call(this, scriptNode, outIdx !== undefined ? outIdx : 0)
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
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null; scriptNode = null }

  buildCaptureGraph()
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
