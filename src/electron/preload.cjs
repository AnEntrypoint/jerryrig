const { ipcRenderer } = require('electron')

const CHANNELS = 2
const SAMPLE_RATE = 48000
const FRAME_SIZE = 960

let playCtx = null
let captureCtx = null
const nextPlayTime = {}

function getPlayCtx() {
  if (!playCtx) playCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  if (playCtx.state === 'suspended') playCtx.resume()
  return playCtx
}

ipcRenderer.on('audio-chunk', (_, { userId, data }) => {
  const ctx = getPlayCtx()
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

ipcRenderer.on('start-capture', (_, { sourceId }) => {
  startLoopbackCapture(sourceId)
})

async function startLoopbackCapture(sourceId) {
  if (captureCtx) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1,
          maxHeight: 1,
          maxFrameRate: 1,
        },
      },
    })

    captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = captureCtx.createMediaStreamSource(stream)
    const processor = captureCtx.createScriptProcessor(FRAME_SIZE, CHANNELS, CHANNELS)

    processor.onaudioprocess = (e) => {
      const left = e.inputBuffer.getChannelData(0)
      const right = e.inputBuffer.getChannelData(1) || left
      const interleaved = new Float32Array(left.length * CHANNELS)
      for (let i = 0; i < left.length; i++) {
        interleaved[i * 2] = left[i]
        interleaved[i * 2 + 1] = right[i]
      }
      ipcRenderer.send('audio-pcm', interleaved.buffer)
    }

    source.connect(processor)
    processor.connect(captureCtx.destination)
    console.log('[capture] Loopback audio capture started')
  } catch (err) {
    console.error('[capture] Loopback capture failed:', err.message)
  }
}
