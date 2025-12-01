const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const objectStorage = require('../services/objectStorage');
const path = require('path');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Admin registration (restricted: in production you would protect this or seed admin)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, region } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    // Prevent creating superadmin via register
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists' });

    const user = new User({ name, email, password, role: 'admin', isApproved: true });
    await user.save();
    res.json({ success: true, message: 'Admin registered' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Multer setup for user avatar uploads (register)
let upload;
if (objectStorage && objectStorage.enabled) {
  upload = multer({ storage: multer.memoryStorage() });
} else {
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(__dirname, '..', 'public', 'uploads'));
    },
    filename: function (req, file, cb) {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    }
  });
  upload = multer({ storage });
}

// Reporter self-registration (will be pending approval)
router.post('/register-reporter', upload.single('avatar'), async (req, res) => {
  try {
    const { name, email, password, region, pressRole } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists' });
    // generate a simple reporterId - try to make collision unlikely
    const makeReporterId = () => {
      const suffix = Date.now().toString().slice(-6);
      const rand = Math.floor(Math.random() * 900 + 100); // 100-999
      return `MB${suffix}${rand}`;
    };

    let reporterId = makeReporterId();
    // ensure uniqueness (rare) - try a few times
    for (let i = 0; i < 5; i++) {
      const found = await User.findOne({ reporterId });
      if (!found) break;
      reporterId = makeReporterId();
    }

    // if avatar uploaded, save path; persist region and pressRole if provided
    let userData = { name, email, password, role: 'reporter', isApproved: false, reporterId };
    if (region && typeof region === 'string' && region.trim()) userData.region = region.trim();
    if (pressRole && typeof pressRole === 'string' && pressRole.trim()) userData.pressRole = pressRole.trim();
    if (req.file) {
      // If memory buffer present and objectStorage enabled, upload to R2
      if (req.file.buffer && objectStorage && objectStorage.enabled) {
        try {
          const ext = path.extname(req.file.originalname || '') || '';
          const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
          const key = `uploads/${filename}`;
          await objectStorage.uploadBuffer(req.file.buffer, key, req.file.mimetype);
          userData.avatar = objectStorage.getPublicUrl(key);
        } catch (e) {
          console.warn('Failed to upload avatar buffer to object storage:', e && e.message);
          if (req.file.filename) userData.avatar = `/uploads/${req.file.filename}`;
        }
      } else if (req.file.filename) {
        userData.avatar = `/uploads/${req.file.filename}`;
        // If object storage enabled but disk storage was used, attempt to upload the local file
        if (objectStorage && objectStorage.enabled) {
          try {
            const local = path.join(__dirname, '..', 'public', 'uploads', req.file.filename);
            const key = `uploads/${req.file.filename}`;
            await objectStorage.uploadFileFromPath(local, key);
            userData.avatar = objectStorage.getPublicUrl(key);
            try { require('fs').unlinkSync(local); } catch (e) { }
          } catch (e) {
            console.warn('Failed to upload avatar file to object storage:', e && e.message);
          }
        }
      }
    }
    const user = new User(userData);
    await user.save();
    res.json({ success: true, message: 'Registered as reporter. Await superadmin approval.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

      // If reporter, ensure approved
      if (user.role === 'reporter' && !user.isApproved) {
        return res.status(403).json({ success: false, message: 'Reporter account pending approval' });
      }

  const token = jwt.sign({ id: user._id, email: user.email, role: user.role, name: user.name }, process.env.JWT_SECRET || 'strong_secret', { expiresIn: process.env.JWT_EXPIRES || '1d' });
  // also return role and name for client convenience
  res.json({ success: true, token, role: user.role, name: user.name, id: user._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin login (fixed credentials from .env)
router.post('/superadmin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const envEmail = process.env.SEED_SUPER_EMAIL;
    const envPass = process.env.SEED_SUPER_PASS;
    if (email === envEmail && password === envPass) {
      const token = jwt.sign({ id: 'superadmin', email, role: 'superadmin', name: 'Super Admin' }, process.env.JWT_SECRET || 'strong_secret', { expiresIn: process.env.JWT_EXPIRES || '1d' });
      return res.json({ success: true, token });
    }
    return res.status(401).json({ success: false, message: 'Invalid superadmin credentials' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Debug: return decoded token payload for the current Authorization header
router.get('/me', auth.verifyToken, (req, res) => {
  try {
    // req.user is set by verifyToken
    res.json({ success: true, data: req.user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

