require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.MONGO_URL;
  if (!uri) {
    console.error('No Mongo URI found in env (MONGO_URI / MONGODB_URI / DATABASE_URL)');
    process.exit(2);
  }
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const reporters = await User.find({ role: 'reporter' }).sort({ createdAt: -1 }).limit(20).lean();
  if (!reporters || reporters.length === 0) {
    console.log('No reporter users found');
    await mongoose.disconnect();
    return;
  }
  console.log(`Found ${reporters.length} reporter(s):`);
  reporters.forEach(u => {
    console.log('---');
    console.log('id:', u._id.toString());
    console.log('name:', u.name);
    console.log('email:', u.email);
    console.log('isApproved:', !!u.isApproved);
    console.log('reporterId:', u.reporterId || '');
    console.log('region:', u.region || '');
    console.log('pressRole:', u.pressRole || '');
    console.log('avatar:', (u.avatar && typeof u.avatar === 'string') ? u.avatar.slice(0,120) : '');
  });
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error', err && err.message);
  process.exit(1);
});
