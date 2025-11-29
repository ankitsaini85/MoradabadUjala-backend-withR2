require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');

function mimeFromExt(name) {
  const ext = path.extname(name || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ujala';
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

  const users = await User.find({
    avatar: { $regex: '^/uploads/' },
    $or: [ { avatarData: { $exists: false } }, { avatarData: null } ]
  }).lean();

  console.log(`Found ${users.length} users with avatar path.`);
  let migrated = 0;
  for (const u of users) {
    try {
      const avatarPath = String(u.avatar || '').trim();
      if (!avatarPath) continue;
      // strip leading slash
      const rel = avatarPath.startsWith('/') ? avatarPath.slice(1) : avatarPath;
      const abs = path.join(__dirname, '..', rel);
      if (!fs.existsSync(abs)) {
        console.log(`File missing on disk for user ${u._id}: ${abs}`);
        continue;
      }
      const data = fs.readFileSync(abs);
      const mime = mimeFromExt(abs);
      const user = await User.findById(u._id);
      if (!user) continue;
      user.avatarData = data;
      user.avatarMime = mime;
      // Optionally keep avatar path or clear it. We'll keep both for now.
      await user.save();
      migrated++;
      console.log(`Migrated avatar for user ${u._id} (${u.email || u.name})`);
    } catch (e) {
      console.error('Error migrating user', u._id, e && e.message);
    }
  }

  console.log(`Migration complete. Migrated ${migrated} avatars.`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
