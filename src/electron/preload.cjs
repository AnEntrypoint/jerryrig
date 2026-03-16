const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000

const NativeAudioContext = window.AudioContext || window.webkitAudioContext

let playCtx = null
let captureCtx = null
let captureWorklet = null
let captureGen = 0
const nextPlayTime = {}

function getPlayCtx() {
  if (!playCtx) playCtx = new NativeAudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  if (playCtx.state === 'suspended') playCtx.resume()
  return playCtx
}

contextBridge.exposeInMainWorld('_gmNav', {
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  go: (url) => ipcRenderer.send('nav-go', url),
})


ipcRenderer.on('start-capture', () => startCapture())
ipcRenderer.on('reset-capture', () => resetCapture())

function resetCapture() {
  captureGen++
  captureWorklet = null
  if (captureCtx) {
    captureCtx.close().catch(() => {})
    captureCtx = null
  }
}

const tappedElements = new WeakSet()
const tappedPageCtxs = new WeakSet()
let tappedCtxCount = 0

function tapElement(el) {
  if (tappedElements.has(el) || !captureCtx || !captureWorklet) return
  tappedElements.add(el)
  try {
    captureCtx.createMediaElementSource(el).connect(captureWorklet)
    ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '> via MediaElementSource')
  } catch (e1) {
    ipcRenderer.send('log', '[capture] MediaElementSource failed: ' + e1.message + ', trying captureStream')
    try {
      const stream = el.captureStream ? el.captureStream() : el.mozCaptureStream()
      captureCtx.createMediaStreamSource(stream).connect(captureWorklet)
      ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '> via captureStream')
    } catch (e2) {
      ipcRenderer.send('log', '[capture] tap failed: ' + e2.message)
    }
  }
}

function tapPageCtx(pageCtx) {
  if (!pageCtx || tappedPageCtxs.has(pageCtx) || pageCtx === captureCtx || pageCtx === playCtx || !captureCtx || !captureWorklet) return
  tappedPageCtxs.add(pageCtx)
  tappedCtxCount++
  try {
    const dest = pageCtx.createMediaStreamDestination()
    const tap = pageCtx.createGain()
    tap.connect(dest)
    captureCtx.createMediaStreamSource(dest.stream).connect(captureWorklet)
    ipcRenderer.send('log', '[capture] tapped AudioContext #' + tappedCtxCount + ' via MediaStreamDestination')

    const _origConnect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...args) {
      if (this.context === pageCtx && target === pageCtx.destination) {
        try { _origConnect.call(this, tap, ...args) } catch {}
      }
      return _origConnect.call(this, target, ...args)
    }
  } catch (e) {
    ipcRenderer.send('log', '[capture] pageCtx tap failed: ' + e.message)
  }
}

if (NativeAudioContext) {
  window.AudioContext = window.webkitAudioContext = function (...args) {
    const ctx = new NativeAudioContext(...args)
    setTimeout(() => tapPageCtx(ctx), 0)
    return ctx
  }
  window.AudioContext.prototype = NativeAudioContext.prototype
}

async function startCapture() {
  captureGen++
  const gen = captureGen

  await new Promise(r => setTimeout(r, 300))
  if (captureGen !== gen) return

  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
  captureWorklet = null

  const ctx = new NativeAudioContext({ sampleRate: SAMPLE_RATE })
  captureCtx = ctx
  await ctx.resume()

  if (captureGen !== gen) { ctx.close().catch(() => {}); return }

  const scriptNode = ctx.createScriptProcessor(4096, 2, 2)
  let _spCount = 0
  scriptNode.onaudioprocess = (e) => {
    const L = e.inputBuffer.getChannelData(0)
    const R = e.inputBuffer.getChannelData(1)
    const out = new Float32Array(L.length * 2)
    for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
    _spCount++
    if (_spCount <= 3 || _spCount % 200 === 0) ipcRenderer.send('log', '[capture] onaudioprocess #' + _spCount)
    ipcRenderer.send('audio-pcm', out.buffer)
  }
  captureWorklet = scriptNode

  const silencer = ctx.createGain()
  silencer.gain.value = 0
  scriptNode.connect(silencer)
  silencer.connect(ctx.destination)

  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  oscGain.gain.value = 0
  osc.connect(oscGain)
  oscGain.connect(scriptNode)
  osc.start()

  ipcRenderer.send('log', '[capture] scriptNode created, ctx.state=' + ctx.state)

  document.querySelectorAll('audio,video').forEach(tapElement)
  new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue
        if (n.matches?.('audio,video')) tapElement(n)
        n.querySelectorAll?.('audio,video').forEach(tapElement)
      }
  }).observe(document.documentElement, { childList: true, subtree: true })

  ipcRenderer.send('log', '[capture] active, elements=' + document.querySelectorAll('audio,video').length)

  const scanInterval = setInterval(() => {
    if (captureGen !== gen) { clearInterval(scanInterval); return }
    document.querySelectorAll('audio,video').forEach(tapElement)
  }, 2000)
}
