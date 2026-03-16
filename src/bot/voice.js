import { Streamer, playStream } from '@dank074/discord-video-stream'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const require = createRequire(import.meta.url)

function resolveFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    return 'ffmpeg'
  } catch {
    return require('ffmpeg-static')
  }
}

const ffmpegPath = resolveFfmpeg()

let streamer = null
let ffmpegProc = null
let frameInput = null

function createStreamer(client) {
  streamer = new Streamer(client)
  return streamer
}

function startFfmpeg(width, height, fps, bitrate) {
  frameInput = new PassThrough()

  ffmpegProc = spawn(ffmpegPath, [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate * 2}k`,
    '-bufsize', `${bitrate / 2}k`,
    '-bf', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-f', 'nut',
    'pipe:1',
  ])

  frameInput.pipe(ffmpegProc.stdin)
  ffmpegProc.stderr.on('data', () => {})
  ffmpegProc.on('error', () => {})

  return ffmpegProc.stdout
}

async function joinAndStream(guildId, channelId, width, height, fps, bitrate) {
  if (!streamer) throw new Error('Streamer not initialized')

  await streamer.joinVoice(guildId, channelId)
  const videoOutput = startFfmpeg(width, height, fps, bitrate)

  playStream(videoOutput, streamer, { type: 'go-live', format: 'nut' }).catch(() => {})
}

function pushFrame(rgbaBuffer) {
  if (frameInput && !frameInput.destroyed) {
    frameInput.write(Buffer.isBuffer(rgbaBuffer) ? rgbaBuffer : Buffer.from(rgbaBuffer))
  }
}

function stopLive() {
  if (frameInput) {
    frameInput.end()
    frameInput = null
  }
  if (ffmpegProc) {
    ffmpegProc.kill('SIGTERM')
    ffmpegProc = null
  }
  if (streamer) {
    try { streamer.leaveVoice() } catch {}
  }
}

export { createStreamer, joinAndStream, pushFrame, stopLive }
