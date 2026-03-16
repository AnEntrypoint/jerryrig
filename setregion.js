const https = require('https')
const env = require('fs').readFileSync('.env', 'utf8')
const TOKEN = env.match(/DISCORD_BOT_TOKEN=(.+)/)[1].trim()
const CHANNEL = env.match(/CHANNEL_ID=(.+)/)[1].trim()
const region = process.argv[2] || 'us-east'
const body = JSON.stringify({ rtc_region: region })
const req = https.request({
  hostname: 'discord.com',
  path: '/api/v10/channels/' + CHANNEL,
  method: 'PATCH',
  headers: { 'Authorization': 'Bot ' + TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = ''
  res.on('data', x => d += x)
  res.on('end', () => { const ch = JSON.parse(d); console.log('region set:', ch.rtc_region, 'status:', res.statusCode) })
})
req.on('error', e => console.log('err:', e.message))
req.write(body)
req.end()
