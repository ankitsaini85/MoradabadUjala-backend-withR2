/**
 * Scan local public/uploads, upload files to R2, and update News documents that reference them.
 * Usage: set OBJECT_STORAGE=1 and R2_BUCKET/R2_ENDPOINT and AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in backend/.env
 * then run: node scripts/migrate-local-uploads-to-r2.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const connectDB = require('../config/database');
const News = require('../models/News');
const objectStorage = require('../services/objectStorage');

async function run() {
  if (!objectStorage.enabled) {
    console.error('Object storage not enabled. Set OBJECT_STORAGE=1 and R2_BUCKET env variables.');
    process.exit(1);
  }
  await connectDB();
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.error('No local uploads directory found at', uploadsDir);
    process.exit(1);
  }
  const files = fs.readdirSync(uploadsDir).filter(f => fs.statSync(path.join(uploadsDir, f)).isFile());
  console.log('Found', files.length, 'local upload files');
  for (const fname of files) {
    try {
      const local = path.join(uploadsDir, fname);
      const key = `uploads/${fname}`;
      console.log('Uploading', fname);
      await objectStorage.uploadFileFromPath(local, key);
      const publicUrl = objectStorage.getPublicUrl(key);
      // Update any News documents that reference this filename
      const regex = new RegExp(fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const docs = await News.find({
        $or: [ { imagePath: { $regex: regex } }, { imageUrl: { $regex: regex } }, { galleryImages: { $regex: regex } } ]
      });
      for (const d of docs) {
        let changed = false;
        if (d.imagePath && d.imagePath.includes(fname)) { d.imageUrl = publicUrl; d.imagePath = undefined; changed = true; }
        if (d.imageUrl && d.imageUrl.includes(fname)) { d.imageUrl = publicUrl; changed = true; }
        if (Array.isArray(d.galleryImages)) {
          d.galleryImages = d.galleryImages.map(u => (u && u.includes(fname)) ? publicUrl : u);
          changed = true;
        }
        if (changed) { await d.save(); console.log('Updated', d._id.toString()); }
      }
      // remove local file
      try { fs.unlinkSync(local); } catch (e) { console.warn('Failed to delete local', local, e && e.message); }
    } catch (err) {
      console.error('Failed migrating', fname, err && err.message);
    }
  }
  console.log('Local migration complete');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
