import 'dotenv/config'
import { Client, GatewayIntentBits } from 'discord.js'

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })

client.on('ready', async () => {
  console.log('[leave] logged in as', client.user.tag)
  const GUILD_ID = process.env.GUILD_ID

  try {
    client.ws.broadcast({ op: 4, d: { guild_id: GUILD_ID, channel_id: null, self_deaf: false, self_mute: false } })
    console.log('[leave] sent VoiceStateUpdate leave')
  } catch (e) {
    console.log('[leave] error:', e.message)
  }

  await new Promise(r => setTimeout(r, 3000))
  console.log('[leave] done, destroying client')
  client.destroy()
  process.exit(0)
})

client.login(process.env.DISCORD_BOT_TOKEN)
