const fs = require('fs');
const url = fs.readFileSync('signed_url.txt','utf8').trim();
const https = require('https');
const u = new URL(url);
const options = { method: 'HEAD', hostname: u.hostname, path: u.pathname + u.search };
console.log('HEAD', url);
const req = https.request(options, (res) => {
  console.log('statusCode', res.statusCode);
  console.log('headers', res.headers);
  res.on('data', () => {});
  res.on('end', () => process.exit(0));
});
req.on('error', (e) => { console.error('ERROR', e && e.message); process.exit(2); });
req.end();
