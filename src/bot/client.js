import { Client } from 'discord.js-selfbot-v13'
import { joinVoiceChannel, EndBehaviorType } from '@discordjs/voice'
import prism from 'prism-media'

let voiceConnection = null
let voiceReceiver = null

function createClient() {
  return new Client({ checkUpdate: false })
}

function joinDiscordVoice(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId)
  if (!guild) throw new Error(`Guild ${guildId} not found`)
  const channel = guild.channels.cache.get(channelId)
  if (!channel) throw new Error(`Channel ${channelId} not found`)

  voiceConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  })

  voiceReceiver = voiceConnection.receiver
  return { voiceConnection, voiceReceiver }
}

function subscribeToSpeaker(userId, onPcmChunk) {
  if (!voiceReceiver) return null

  const existing = voiceReceiver.subscriptions.get(userId)
  if (existing) return existing

  const stream = voiceReceiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
  })

  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 })
  stream.pipe(decoder)

  decoder.on('data', (pcmBuf) => {
    const i16 = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 2)
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
    onPcmChunk(userId, f32)
  })

  decoder.on('error', () => {})
  stream.on('close', () => decoder.destroy())

  return stream
}

function leaveVoice() {
  if (voiceConnection) {
    voiceConnection.destroy()
    voiceConnection = null
    voiceReceiver = null
  }
}

export { createClient, joinDiscordVoice, subscribeToSpeaker, leaveVoice }
