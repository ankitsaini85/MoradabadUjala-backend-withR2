require('dotenv').config();
const os = require('../services/objectStorage');
const key = process.argv[2];
if (!key) { console.error('Usage: node print-signed.js <key>'); process.exit(1); }
try {
  console.log(os.getSignedUrl(key));
} catch (e) {
  console.error('ERR', e && e.message);
  process.exit(1);
}
