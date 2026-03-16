const https = require('https')
const env = require('fs').readFileSync('.env', 'utf8')
const TOKEN = env.match(/DISCORD_BOT_TOKEN=(.+)/)[1].trim()
const GUILD = env.match(/GUILD_ID=(.+)/)[1].trim()
const body = JSON.stringify({ channel_id: null })
const req = https.request({
  hostname: 'discord.com',
  path: '/api/v10/guilds/' + GUILD + '/voice-states/@me',
  method: 'PATCH',
  headers: { 'Authorization': 'Bot ' + TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = ''
  res.on('data', x => d += x)
  res.on('end', () => console.log('PATCH voice state:', res.statusCode, d.slice(0, 300)))
})
req.on('error', e => console.log('err:', e.message))
req.write(body)
req.end()
