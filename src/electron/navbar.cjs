function normalizeUrl(raw) {
  const s = raw.trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(s)) return s
  return 'https://' + s
}

function injectNavBar() {
  if (document.getElementById('_gm_navbar')) return

  const nav = window._gmNav

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
  back.onclick = () => nav.back()

  const fwd = document.createElement('button')
  fwd.textContent = '\u203a'
  fwd.title = 'Forward'
  fwd.style.cssText = btnStyle
  fwd.onclick = () => nav.forward()

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
    if (url) nav.go(url)
  }

  bar.appendChild(back)
  bar.appendChild(fwd)
  bar.appendChild(input)
  bar.appendChild(goBtn)
  document.documentElement.insertBefore(bar, document.body)

  document.documentElement.style.boxSizing = 'border-box'
  document.documentElement.style.paddingTop = '36px'
  if (document.body) {
    document.body.style.boxSizing = 'border-box'
    document.body.style.paddingTop = '36px'
  }

  window.addEventListener('popstate', () => {
    const el = document.getElementById('_gm_navbar_url')
    if (el) el.value = location.href
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectNavBar)
} else {
  injectNavBar()
}

if (location.hostname.includes('youtube.com')) {
  const AD_SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
  ]

  function trySkipAd() {
    for (const sel of AD_SKIP_SELECTORS) {
      const btn = document.querySelector(sel)
      if (btn) {
        btn.click()
        return
      }
    }
    const adShowing = document.querySelector('.ad-showing')
    if (adShowing) {
      const video = document.querySelector('video')
      if (video && video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration
      }
    }
  }

  const _adObserver = new MutationObserver(trySkipAd)
  _adObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  trySkipAd()
}
