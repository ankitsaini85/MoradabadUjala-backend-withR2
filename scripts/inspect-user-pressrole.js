require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.MONGO_URL;
  if (!uri) {
    console.error('No Mongo URI found in env (MONGO_URI / MONGODB_URI / DATABASE_URL)');
    process.exit(2);
  }
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/inspect-user-pressrole.js <email>');
    process.exit(2);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const user = await User.findOne({ email }).lean();
  if (!user) {
    console.log('User not found for', email);
    process.exit(0);
  }
  console.log('User:', {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    isApproved: user.isApproved,
    reporterId: user.reporterId,
    region: user.region,
    pressRole: user.pressRole,
    avatar: user.avatar && user.avatar.slice ? user.avatar.slice(0,200) : user.avatar,
  });
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error', err && err.message);
  process.exit(1);
});
