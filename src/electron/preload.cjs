const { ipcRenderer } = require('electron')

const SAMPLE_RATE = 48000
const _origConnect = AudioNode.prototype.connect

let captureCtx = null
let captureGen = 0

window._gmNav = {
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  go: (url) => ipcRenderer.send('nav-go', url),
}

ipcRenderer.on('start-capture', () => startCapture())
ipcRenderer.on('reset-capture', () => {
  captureGen++
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
})

async function startCapture() {
  captureGen++
  const gen = captureGen

  await new Promise(r => setTimeout(r, 300))
  if (captureGen !== gen) return
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }

  let stream = null
  try {
    const sourceId = await ipcRenderer.invoke('get-screen-source-id')
    if (sourceId) {
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, minWidth: 1, maxWidth: 1, minHeight: 1, maxHeight: 1, maxFrameRate: 1 } },
        }).then(s => { s.getVideoTracks().forEach(t => t.stop()); return s }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ])
      ipcRenderer.send('log', '[capture] screen stream acquired, tracks=' + stream.getAudioTracks().length)
    }
  } catch (e) {
    ipcRenderer.send('log', '[capture] screen capture failed: ' + e.message)
  }

  if (captureGen !== gen) { if (stream) stream.getTracks().forEach(t => t.stop()); return }
  if (!stream || !stream.getAudioTracks().length) {
    ipcRenderer.send('log', '[capture] no stream, retrying in 2s')
    setTimeout(() => { if (captureGen === gen) startCapture() }, 2000)
    return
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
  captureCtx = ctx
  await ctx.resume()
  if (captureGen !== gen) { ctx.close().catch(() => {}); return }

  const scriptNode = ctx.createScriptProcessor(4096, 2, 2)
  let _count = 0
  scriptNode.onaudioprocess = (e) => {
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
  _origConnect.call(scriptNode, silencer)
  _origConnect.call(silencer, ctx.destination)
  _origConnect.call(ctx.createMediaStreamSource(stream), scriptNode)

  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  oscGain.gain.value = 0
  _origConnect.call(osc, oscGain)
  _origConnect.call(oscGain, scriptNode)
  osc.start()

  ipcRenderer.send('log', '[capture] active')
}
