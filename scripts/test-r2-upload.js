require('dotenv').config();
const os = require('../services/objectStorage');
(async () => {
  try {
    if (!os.enabled) {
      console.error('OBJECT_STORAGE not enabled in .env');
      process.exit(2);
    }
    const key = 'uploads/test-' + Date.now() + '.txt';
    await os.uploadBuffer(Buffer.from('r2-test-' + Date.now()), key, 'text/plain');
    console.log('UPLOADED_KEY=' + key);
    const exists = await os.objectExists(key);
    console.log('EXISTS=' + exists);
    console.log('PUBLIC=' + os.getPublicUrl(key));
    console.log('SIGNED=' + os.getSignedUrl(key));
  } catch (e) {
    console.error('ERR', e && e.stack || e);
    process.exit(1);
  }
})();
