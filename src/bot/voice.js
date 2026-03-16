import { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice'
import { PassThrough } from 'node:stream'
import prism from 'prism-media'

let audioPlayer = null
let pcmInput = null
let voiceConn = null

function initVoicePlayer(connection) {
  voiceConn = connection
  audioPlayer = createAudioPlayer()
  connection.subscribe(audioPlayer)

  audioPlayer.on('error', (err) => console.error('[voice] AudioPlayer error:', err.message))
  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    if (pcmInput && !pcmInput.destroyed) _startPlayback()
  })

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    try { connection.rejoin() } catch {}
  })

  _startPlayback()
}

function _startPlayback() {
  if (pcmInput) {
    try { pcmInput.destroy() } catch {}
  }
  pcmInput = new PassThrough()

  const encoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 })
  pcmInput.pipe(encoder)

  const resource = createAudioResource(encoder, { inputType: StreamType.Opus })
  audioPlayer.play(resource)
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
