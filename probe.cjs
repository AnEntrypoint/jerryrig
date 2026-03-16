const http = require('http')
http.get('http://127.0.0.1:9222/json', res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => {
    const pages = JSON.parse(d)
    console.log(JSON.stringify(pages.map(p => ({ url: p.url, title: p.title, wsUrl: p.webSocketDebuggerUrl })), null, 2))
  })
}).on('error', e => console.error('CDP error:', e.message))
