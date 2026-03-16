import http from 'node:http';
const req = http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    console.log('CDP tabs:', JSON.stringify(tabs.map(t=>({id:t.id,url:t.url,title:t.title})), null, 2));
  });
});
req.on('error', e => console.log('CDP not available:', e.message));
