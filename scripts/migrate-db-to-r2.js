/**
 * Migration: update News documents that reference local /uploads/... paths to point to Cloudflare R2 public URLs.
 * This script will only update entries for which the object exists in the configured bucket (checks HEAD).
 *
 * Usage: set OBJECT_STORAGE=1 and R2_BUCKET/R2_ENDPOINT and AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in backend/.env
 * then run: node scripts/migrate-db-to-r2.js
 */
require('dotenv').config();
const connectDB = require('../config/database');
const News = require('../models/News');
const objectStorage = require('../services/objectStorage');

async function run() {
  if (!objectStorage.enabled) {
    console.error('Object storage not enabled. Set OBJECT_STORAGE=1 and R2_BUCKET env variables.');
    process.exit(1);
  }
  await connectDB();

  // Find docs that have local imagePath/imageUrl or galleryImages containing /uploads/
  const docs = await News.find({
    $or: [
      { imagePath: { $regex: '^/uploads/' } },
      { imageUrl: { $regex: '^/uploads/' } },
      { galleryImages: { $elemMatch: { $regex: '^/uploads/' } } },
    ],
  }).lean();

  console.log(`Found ${docs.length} news documents referencing local uploads.`);
  for (const d of docs) {
    try {
      const updates = {};
      if (d.imagePath && d.imagePath.startsWith('/uploads/')) {
        const fname = d.imagePath.split('/').pop();
        const key = `uploads/${fname}`;
        const exists = await objectStorage.objectExists(key);
        if (exists) { updates.imageUrl = objectStorage.getPublicUrl(key); updates.imagePath = undefined; }
      }
      if (d.imageUrl && d.imageUrl.startsWith('/uploads/')) {
        const fname = d.imageUrl.split('/').pop();
        const key = `uploads/${fname}`;
        const exists = await objectStorage.objectExists(key);
        if (exists) { updates.imageUrl = objectStorage.getPublicUrl(key); updates.imagePath = undefined; }
      }
      if (Array.isArray(d.galleryImages) && d.galleryImages.length > 0) {
        const newGallery = [];
        let changed = false;
        for (const u of d.galleryImages) {
          if (u && u.startsWith('/uploads/')) {
            const fname = u.split('/').pop();
            const key = `uploads/${fname}`;
            const exists = await objectStorage.objectExists(key);
            if (exists) { newGallery.push(objectStorage.getPublicUrl(key)); changed = true; continue; }
          }
          newGallery.push(u);
        }
        if (changed) updates.galleryImages = newGallery;
      }

      if (Object.keys(updates).length) {
        await News.updateOne({ _id: d._id }, { $set: updates });
        console.log('Updated', d._id.toString(), updates);
      }
    } catch (err) {
      console.error('Failed to update', d._id.toString(), err && err.message);
    }
  }

  console.log('Migration finished');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
