// CDP helper — usage: node cdp.mjs <command> [args]
// Commands: snapshot, navigate <url>, click <ref>, fill <ref> <text>, screenshot <file>
import WebSocket from 'ws'

const PORT = process.env.CDP_PORT || 9229
const [,, cmd, ...args] = process.argv

const tabs = await fetch(`http://127.0.0.1:${PORT}/json`).then(r=>r.json())
const tab = tabs.find(t => t.webSocketDebuggerUrl)
if (!tab) { console.error('No CDP tab found'); process.exit(1) }

const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(r => ws.on('open', r))

let id = 1
const send = (method, params={}) => new Promise(resolve => {
  const msgId = id++
  ws.once('message', function handler(data) {
    const msg = JSON.parse(data)
    if (msg.id === msgId) resolve(msg.result)
    else ws.once('message', handler)
  })
  ws.send(JSON.stringify({ id: msgId, method, params }))
})

if (cmd === 'navigate') {
  const url = args[0]
  await send('Page.navigate', { url })
  await new Promise(r => setTimeout(r, 3000))
  const { result } = await send('Runtime.evaluate', { expression: 'document.title + " | " + location.href' })
  console.log('Navigated:', result.value)
}

if (cmd === 'snapshot') {
  const { result } = await send('Runtime.evaluate', { expression: `
    JSON.stringify(Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,input')).slice(0,40).map(el=>({
      tag: el.tagName.toLowerCase(),
      text: el.innerText?.slice(0,80),
      href: el.href||undefined,
      name: el.name||el.id||undefined
    })))
  ` })
  const els = JSON.parse(result.value)
  els.forEach(e => console.log(`<${e.tag}>${e.text || ''}${e.href?' ['+e.href+']':''}`))
}

if (cmd === 'eval') {
  const expr = args.join(' ')
  const { result } = await send('Runtime.evaluate', { expression: expr, awaitPromise: true })
  console.log(result.value ?? JSON.stringify(result))
}

if (cmd === 'screenshot') {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = args[0] || 'screenshot.png'
  require('fs').writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('Saved:', file)
}

ws.close()
