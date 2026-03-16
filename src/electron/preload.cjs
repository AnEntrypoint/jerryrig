const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000

const NativeAudioContext = window.AudioContext || window.webkitAudioContext

let playCtx = null
let captureCtx = null
let captureWorklet = null
let captureStarting = false
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
  captureStarting = false
  captureWorklet = null
  if (captureCtx) {
    captureCtx.close().catch(() => {})
    captureCtx = null
  }
}

const tappedElements = new WeakSet()
const tappedPageCtxs = new WeakSet()

function tapElement(el) {
  if (tappedElements.has(el) || !captureCtx || !captureWorklet) return
  tappedElements.add(el)
  try {
    captureCtx.createMediaElementSource(el).connect(captureWorklet)
    ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '> via MediaElementSource')
  } catch {
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
  try {
    const dest = pageCtx.createMediaStreamDestination()
    const tap = pageCtx.createGain()
    tap.connect(dest)
    captureCtx.createMediaStreamSource(dest.stream).connect(captureWorklet)
    ipcRenderer.send('log', '[capture] tapped page AudioContext via MediaStreamDestination')

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
  resetCapture()
  captureStarting = true

  const ctx = new NativeAudioContext({ sampleRate: SAMPLE_RATE })
  captureCtx = ctx
  await ctx.resume()

  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  let worklet = null
  try {
    await ctx.audioWorklet.addModule(url)
    worklet = new AudioWorkletNode(ctx, 'pcm-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [CHANNELS],
    })
    worklet.port.onmessage = (e) => ipcRenderer.send('audio-pcm', e.data)
  } catch (err) {
    ipcRenderer.send('log', '[capture] worklet failed: ' + err.message)
  } finally {
    URL.revokeObjectURL(url)
  }

  if (!worklet || !captureStarting || captureCtx !== ctx) {
    ctx.close().catch(() => {})
    return
  }

  captureStarting = false
  captureWorklet = worklet

  const silencer = ctx.createGain()
  silencer.gain.value = 0
  worklet.connect(silencer)
  silencer.connect(ctx.destination)

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
}
