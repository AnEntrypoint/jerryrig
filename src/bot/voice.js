import { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice'
import { PassThrough } from 'node:stream'
import prism from 'prism-media'

let audioPlayer = null
let pcmInput = null
let voiceConn = null
let _pushCount = 0

function _generateTestTone() {
  const SAMPLE_RATE = 48000
  const CHANNELS = 2
  const DURATION_S = 5
  const FREQ = 440
  const totalSamples = SAMPLE_RATE * DURATION_S
  const s16 = new Int16Array(totalSamples * CHANNELS)
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.sin(2 * Math.PI * FREQ * i / SAMPLE_RATE)
    const s = Math.round(v * 16383)
    s16[i * 2] = s
    s16[i * 2 + 1] = s
  }
  return Buffer.from(s16.buffer)
}

function _makeStream() {
  if (pcmInput) {
    try { pcmInput.destroy() } catch {}
  }
  pcmInput = new PassThrough({ highWaterMark: 960 * 2 * 2 * 200 })
  const encoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 })
  pcmInput.pipe(encoder)
  const resource = createAudioResource(encoder, { inputType: StreamType.Opus })
  return resource
}

function _playTestTone() {
  const toneBuf = _generateTestTone()
  const CHUNK = 960 * 2 * 2
  let offset = 0
  const interval = setInterval(() => {
    if (!pcmInput || pcmInput.destroyed || offset >= toneBuf.length) {
      clearInterval(interval)
      console.log('[voice] test tone complete')
      return
    }
    pcmInput.write(toneBuf.slice(offset, offset + CHUNK))
    offset += CHUNK
  }, 10)
}

function initVoicePlayer(connection) {
  if (audioPlayer) { try { audioPlayer.stop() } catch {} }
  voiceConn = connection
  audioPlayer = createAudioPlayer()

  console.log('[voice] connection state on init:', connection.state.status)

  connection.on('stateChange', (oldState, newState) => {
    console.log(`[voice] connection: ${oldState.status} -> ${newState.status}`)
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try { connection.rejoin() } catch {}
    }
  })

  audioPlayer.on('error', (err) => console.error('[voice] player error:', err.message))
  audioPlayer.on('stateChange', (oldState, newState) => {
    console.log(`[voice] player: ${oldState.status} -> ${newState.status}`)
    if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
      console.log('[voice] stream ended, restarting stream')
      const resource = _makeStream()
      audioPlayer.play(resource)
    }
  })

  connection.subscribe(audioPlayer)

  const resource = _makeStream()
  audioPlayer.play(resource)
  console.log('[voice] player started')
}

function pushAudioFrame(f32Buffer) {
  if (!pcmInput || pcmInput.destroyed) return
  const f32 = f32Buffer instanceof Float32Array ? f32Buffer : new Float32Array(f32Buffer)
  const s16 = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, f32[i]))
    s16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }
  pcmInput.write(Buffer.from(s16.buffer))
  _pushCount++
  if (_pushCount <= 5 || _pushCount % 500 === 0) {
    const peak = Math.max(...Array.from(f32).map(Math.abs))
    console.log(`[voice] push #${_pushCount}, bytes=${s16.byteLength}, peak=${peak.toFixed(4)}, player=${audioPlayer?.state?.status}`)
  }
}

function stopAudio() {
  if (pcmInput) {
    try { pcmInput.end() } catch {}
    pcmInput = null
  }
  if (audioPlayer) {
    audioPlayer.stop()
    audioPlayer = null
  }
  voiceConn = null
}

export { initVoicePlayer, pushAudioFrame, stopAudio }
