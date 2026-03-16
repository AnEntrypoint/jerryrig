const { ipcRenderer } = require('electron')

const SAMPLE_RATE = 48000

let captureCtx = null
let captureGen = 0
let workletNode = null

void (function spoofBrowserEnv() {
  Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ]
      arr.__proto__ = PluginArray.prototype
      return arr
    },
    configurable: true,
  })
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true })
  try {
    const _getParameter = WebGLRenderingContext.prototype.getParameter
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.'
      if (param === 37446) return 'Intel Iris OpenGL Engine'
      return _getParameter.call(this, param)
    }
  } catch (_) {}
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true })
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true })
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true })
    Object.defineProperty(navigator, 'appVersion', {
      get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      configurable: true,
    })
  } catch (_) {}
  delete window.electron
  delete window.__electronjs
})()

function normalizeUrl(raw) {
  const s = raw.trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(s)) return s
  if (/\s/.test(s) || !/\./.test(s)) return 'https://www.google.com/search?q=' + encodeURIComponent(s)
  return 'https://' + s
}

function injectNavBar() {
  if (document.getElementById('_gm_navbar')) return

  const bar = document.createElement('div')
  bar.id = '_gm_navbar'
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:36px',
    'background:#1a1a1a', 'display:flex', 'align-items:center',
    'gap:4px', 'padding:0 8px', 'z-index:2147483647',
    'box-sizing:border-box', 'font-family:system-ui,sans-serif',
  ].join(';')

  const btnStyle = [
    'background:#333', 'color:#ccc', 'border:none', 'border-radius:4px',
    'width:28px', 'height:24px', 'cursor:pointer', 'font-size:14px',
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-shrink:0',
  ].join(';')

  const back = document.createElement('button')
  back.textContent = '\u2039'
  back.title = 'Back'
  back.style.cssText = btnStyle
  back.onclick = () => ipcRenderer.send('nav-back')

  const fwd = document.createElement('button')
  fwd.textContent = '\u203a'
  fwd.title = 'Forward'
  fwd.style.cssText = btnStyle
  fwd.onclick = () => ipcRenderer.send('nav-forward')

  const input = document.createElement('input')
  input.id = '_gm_navbar_url'
  input.type = 'text'
  input.value = location.href
  input.style.cssText = [
    'flex:1', 'height:24px', 'background:#2a2a2a', 'color:#eee',
    'border:1px solid #444', 'border-radius:4px', 'padding:0 8px',
    'font-size:13px', 'outline:none', 'box-sizing:border-box',
  ].join(';')
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go()
  })

  const goBtn = document.createElement('button')
  goBtn.textContent = 'Go'
  goBtn.style.cssText = [
    'background:#0066cc', 'color:#fff', 'border:none', 'border-radius:4px',
    'padding:0 10px', 'height:24px', 'cursor:pointer', 'font-size:13px',
    'flex-shrink:0',
  ].join(';')
  goBtn.onclick = go

  function go() {
    const url = normalizeUrl(input.value)
    if (url) ipcRenderer.send('nav-go', url)
  }

  bar.appendChild(back)
  bar.appendChild(fwd)
  bar.appendChild(input)
  bar.appendChild(goBtn)
  document.documentElement.insertBefore(bar, document.body)

  document.documentElement.style.setProperty('padding-top', '36px', 'important')
  document.documentElement.style.setProperty('box-sizing', 'border-box', 'important')
  const obs = new MutationObserver(() => {
    document.documentElement.style.setProperty('padding-top', '36px', 'important')
  })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

  window.addEventListener('popstate', () => {
    const el = document.getElementById('_gm_navbar_url')
    if (el) el.value = location.href
  })
}

function injectYoutubeAdSkip() {
  if (!location.hostname.includes('youtube.com')) return
  const SELECTORS = ['.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern']
  function trySkip() {
    for (const sel of SELECTORS) {
      const btn = document.querySelector(sel)
      if (btn) { btn.click(); return }
    }
    const video = document.querySelector('.ad-showing video')
    if (video && video.duration && isFinite(video.duration)) video.currentTime = video.duration
  }
  const obs = new MutationObserver(trySkip)
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  trySkip()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectNavBar(); injectYoutubeAdSkip() })
} else {
  injectNavBar()
  injectYoutubeAdSkip()
}

window.addEventListener('load', () => {
  const el = document.getElementById('_gm_navbar_url')
  if (el) el.value = location.href
})

ipcRenderer.on('start-capture', () => startCapture())
ipcRenderer.on('reset-capture', () => {
  captureGen++
  if (captureCtx) { captureCtx.close().catch(() => {}); captureCtx = null }
  workletNode = null
})

let _ctxSeq = 0
async function buildCaptureGraph() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
  ctx.__id = ++_ctxSeq
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
  if (!captureCtx || captureCtx.state === 'closed' || !workletNode) return
  if (el._gmCtxId === captureCtx.__id) return
  el._gmCtxId = captureCtx.__id
  try {
    const src = captureCtx.createMediaElementSource(el)
    src.connect(workletNode)
    ipcRenderer.send('log', '[capture] media element connected: ' + (el.src || el.currentSrc || 'unknown').slice(0, 80))
  } catch (e) {
    ipcRenderer.send('log', '[capture] media element connect failed: ' + e.message)
  }
}

function patchAudioNodeConnect() {
  const _orig = AudioNode.prototype.connect
  AudioNode.prototype.connect = function(target, outIdx, inIdx) {
    const r = outIdx !== undefined ? _orig.call(this, target, outIdx, inIdx !== undefined ? inIdx : 0) : _orig.call(this, target)
    if (target instanceof AudioDestinationNode && workletNode) {
      try { _orig.call(this, workletNode, outIdx !== undefined ? outIdx : 0) } catch (_) {}
    }
    return r
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
  patchAudioNodeConnect()

  const rescan = setInterval(() => {
    if (captureGen !== gen) { clearInterval(rescan); return }
    scanMediaElements()
  }, 2000)

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
