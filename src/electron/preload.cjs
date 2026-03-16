const { ipcRenderer } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000
let audioCtx = null
const nextPlayTime = {}

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

ipcRenderer.on('audio-chunk', (_, { userId, data }) => {
  const ctx = getCtx()
  const f32 = new Float32Array(data)
  const samplesPerCh = Math.floor(f32.length / CHANNELS)
  if (!samplesPerCh) return
  const buf = ctx.createBuffer(CHANNELS, samplesPerCh, SAMPLE_RATE)
  for (let ch = 0; ch < CHANNELS; ch++) {
    const cd = buf.getChannelData(ch)
    for (let i = 0; i < samplesPerCh; i++) cd[i] = f32[i * CHANNELS + ch]
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  const now = ctx.currentTime
  if (!nextPlayTime[userId] || nextPlayTime[userId] < now) nextPlayTime[userId] = now + 0.06
  src.start(nextPlayTime[userId])
  nextPlayTime[userId] += buf.duration
})

ipcRenderer.on('stream-ready', (_, opts) => {
  startCapture(opts)
})

async function startCapture({ sourceId, width, height, fps }) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: width, maxWidth: width,
          minHeight: height, maxHeight: height,
          minFrameRate: fps, maxFrameRate: fps,
        },
      },
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    const canvas = new OffscreenCanvas(width, height)
    const ctx2d = canvas.getContext('2d')
    setInterval(() => {
      ctx2d.drawImage(video, 0, 0, width, height)
      const imageData = ctx2d.getImageData(0, 0, width, height)
      ipcRenderer.send('video-frame', imageData.data.buffer)
    }, 1000 / fps)
  } catch (err) {
    console.error('[capture]', err.message)
  }
}
