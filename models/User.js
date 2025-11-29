const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'superadmin', 'reporter'], default: 'admin' },
  // reporter accounts require approval by superadmin before they can login
  isApproved: { type: Boolean, default: false },
  // Unique reporter identifier (e.g. RJ-123456), generated at registration for reporters
  reporterId: { type: String, unique: true, sparse: true },
  // When the reporter was approved by admin/superadmin
  approvedAt: { type: Date },
  // Optional avatar path for reporter ID card
  avatar: { type: String },
  // Reporter region/locality (shown on press ID card)
  region: { type: String },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
