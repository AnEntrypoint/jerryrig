import { desktopCapturer } from 'electron'
import { sendFrame } from './swarm.js'

const WINDOW_TITLE = 'Discord Voice Bridge'
let interval = null

function startScreenCapture() {
  if (interval) return
  interval = setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1280, height: 720 } })
      const src = sources.find(s => s.name === WINDOW_TITLE) || sources[0]
      if (!src) return
      sendFrame(src.thumbnail.toJPEG(60))
    } catch {}
  }, 100)
}

function stopScreenCapture() {
  if (interval) { clearInterval(interval); interval = null }
}

export { startScreenCapture, stopScreenCapture }
