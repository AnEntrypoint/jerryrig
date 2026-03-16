void (function() {
  if (window._gmAudioPatched) return
  window._gmAudioPatched = true

  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return

  const masterCtx = new Ctx({ sampleRate: 48000 })
  const dest = masterCtx.createMediaStreamDestination()
  masterCtx.resume().catch(() => {})

  const setStream = window._gmSetStream
  if (typeof setStream === 'function') {
    setStream(dest.stream)
  } else {
    // _gmSetStream not ready yet — store on window for preload to poll
    window._gmAudioStream = dest.stream
  }

  const _orig = AudioNode.prototype.connect
  AudioNode.prototype.connect = function(target, outIdx, inIdx) {
    if (target instanceof AudioDestinationNode) {
      _orig.call(this, dest, outIdx !== undefined ? outIdx : 0)
      return dest
    }
    return outIdx !== undefined ? _orig.call(this, target, outIdx, inIdx) : _orig.call(this, target)
  }
})()
