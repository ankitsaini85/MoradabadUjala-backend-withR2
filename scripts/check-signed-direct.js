require('dotenv').config();
const os = require('../services/objectStorage');
const https = require('https');
(async()=>{
  try{
    const key = process.argv[2];
    if(!key){ console.error('Usage: node check-signed-direct.js <key>'); process.exit(1); }
    if(!os.enabled){ console.error('OBJECT_STORAGE not enabled'); process.exit(2); }
    const url = os.getSignedUrl(key);
    console.log('SIGNED_URL='+url);
    const u = new URL(url);
    const options = { method: 'HEAD', hostname: u.hostname, path: u.pathname + u.search };
    const req = https.request(options, (res) => {
      console.log('statusCode', res.statusCode);
      console.log('headers', res.headers);
      res.on('data', ()=>{});
      res.on('end', ()=>process.exit(res.statusCode===200?0:exitCode(res.statusCode)));
    });
    req.on('error', (e)=>{ console.error('REQ_ERR', e && e.message); process.exit(3); });
    req.end();
  }catch(e){ console.error('ERR', e && e.stack || e); process.exit(4); }
})();
function exitCode(code){ return code && code>=200 && code<400 ? 0 : 5; }
