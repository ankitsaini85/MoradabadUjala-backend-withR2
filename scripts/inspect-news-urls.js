require('dotenv').config();
const connectDB = require('../config/database');
const News = require('../models/News');

async function run(ids) {
  await connectDB();
  for (const id of ids) {
    try {
      const doc = await News.findById(id).lean();
      if (!doc) {
        console.log(id, '-> NOT FOUND');
        continue;
      }
      console.log('---', id, '---');
      console.log('imageUrl:', doc.imageUrl);
      console.log('imagePath:', doc.imagePath);
      console.log('videoUrl:', doc.videoUrl);
      console.log('videoPath:', doc.videoPath);
      console.log('galleryImages:', Array.isArray(doc.galleryImages) ? doc.galleryImages.join('\n  ') : doc.galleryImages);
    } catch (e) {
      console.error('Error for', id, e && e.message);
    }
  }
  process.exit(0);
}

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/inspect-news-urls.js <id1> <id2> ...');
  process.exit(1);
}

run(ids).catch(err => { console.error(err); process.exit(1); });
