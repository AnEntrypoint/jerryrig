void (function () {
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

  const _getParameter = WebGLRenderingContext.prototype.getParameter
  WebGLRenderingContext.prototype.getParameter = function (param) {
    if (param === 37445) return 'Intel Inc.'
    if (param === 37446) return 'Intel Iris OpenGL Engine'
    return _getParameter.call(this, param)
  }

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
