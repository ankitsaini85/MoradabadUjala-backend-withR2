require('dotenv').config();
const mongoose = require('mongoose');
const News = require('../models/News');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ujala';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to DB');

  // Search for 'undefined' in imagePath, imageUrl or galleryImages
  const regex = /undefined/;
  const docs = await News.find({
    $or: [
      { imagePath: { $regex: regex } },
      { imageUrl: { $regex: regex } },
      { galleryImages: { $elemMatch: { $regex: regex } } },
    ],
  }).lean();

  console.log(`Found ${docs.length} documents referencing 'undefined':`);
  docs.forEach((d) => {
    console.log('---');
    console.log('id:', d._id);
    console.log('title:', d.title);
    console.log('imagePath:', d.imagePath);
    console.log('imageUrl:', d.imageUrl);
    console.log('galleryImages:', d.galleryImages && d.galleryImages.slice(0,10));
  });

  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
