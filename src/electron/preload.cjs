const { ipcRenderer, contextBridge } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000
const NativeAudioContext = window.AudioContext || window.webkitAudioContext

let captureCtx = null
let captureWorklet = null
let captureGen = 0

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
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
}

async function startCapture() {
  captureGen++
  const gen = captureGen

  await new Promise(r => setTimeout(r, 300))
  if (captureGen !== gen) return

  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
  captureWorklet = null

  // Get system audio loopback via desktopCapturer
  let stream = null
  try {
    const sourceId = await ipcRenderer.invoke('get-desktop-source-id')
    if (sourceId) {
      const gumPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          }
        },
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, minWidth: 1, maxWidth: 1, minHeight: 1, maxHeight: 1, maxFrameRate: 1 } },
      }).then(s => { s.getVideoTracks().forEach(t => t.stop()); return s })
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('getUserMedia timeout after 8s')), 8000))
      stream = await Promise.race([gumPromise, timeout])
      ipcRenderer.send('log', '[capture] loopback stream acquired, tracks=' + stream.getAudioTracks().length)
    }
  } catch (e) {
    ipcRenderer.send('log', '[capture] loopback failed: ' + e.message + ', falling back to element tap')
  }

  if (captureGen !== gen) { if (stream) stream.getTracks().forEach(t => t.stop()); return }

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
    if (_spCount <= 3 || _spCount % 500 === 0) ipcRenderer.send('log', '[capture] onaudioprocess #' + _spCount)
    ipcRenderer.send('audio-pcm', out.buffer)
  }
  captureWorklet = scriptNode

  const silencer = ctx.createGain()
  silencer.gain.value = 0
  scriptNode.connect(silencer)
  silencer.connect(ctx.destination)

  // Keep graph alive with silent oscillator
  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  oscGain.gain.value = 0
  osc.connect(oscGain)
  oscGain.connect(scriptNode)
  osc.start()

  if (stream && stream.getAudioTracks().length) {
    ctx.createMediaStreamSource(stream).connect(scriptNode)
    ipcRenderer.send('log', '[capture] loopback source connected')
  } else {
    // Fallback: tap <audio>/<video> elements
    tapAllElements()
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue
          if (n.matches?.('audio,video')) tapElement(n)
          n.querySelectorAll?.('audio,video').forEach(tapElement)
        }
    }).observe(document.documentElement, { childList: true, subtree: true })

    setInterval(() => {
      if (captureGen !== gen) return
      tapAllElements()
    }, 2000)
  }

  ipcRenderer.send('log', '[capture] active')
}

const tappedElements = new WeakMap()

function tapElement(el) {
  if (!captureCtx || !captureWorklet) return
  const stream = el.captureStream ? el.captureStream() : (el.mozCaptureStream ? el.mozCaptureStream() : null)
  if (!stream || !stream.getAudioTracks().length) return
  const prev = tappedElements.get(el)
  if (prev) { try { prev.disconnect() } catch {} }
  try {
    const src = captureCtx.createMediaStreamSource(stream)
    src.connect(captureWorklet)
    tappedElements.set(el, src)
    ipcRenderer.send('log', '[capture] tapped <' + el.tagName.toLowerCase() + '>')
  } catch (e) {
    ipcRenderer.send('log', '[capture] tap failed: ' + e.message)
  }
}

function tapAllElements() {
  document.querySelectorAll('audio,video').forEach(el => {
    const prev = tappedElements.get(el)
    if (prev) {
      const stream = el.captureStream ? el.captureStream() : null
      if (!stream || !stream.getAudioTracks().length || stream.getAudioTracks()[0].readyState === 'ended') {
        tapElement(el)
      }
    } else {
      tapElement(el)
    }
  })
}
