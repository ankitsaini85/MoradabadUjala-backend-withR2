const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const objectStorage = require('../services/objectStorage');

// List reporter accounts (superadmin only)
router.get('/reporters', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const reporters = await User.find({ role: 'reporter' }).select('-password').lean();
    // Normalize avatar: prefer DB blob -> data URL; else ensure local /uploads file exists, otherwise clear to avoid 404s
    const fs = require('fs');
    const path = require('path');
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    const mapped = reporters.map(u => {
      let avatar = '';
      if (u.avatarData && u.avatarMime) {
        try { avatar = `data:${u.avatarMime};base64,${Buffer.from(u.avatarData).toString('base64')}`; } catch (e) { avatar = ''; }
      }
      if (!avatar) {
        if (u.avatar && /^https?:\/\//i.test(u.avatar)) {
          // If objectStorage enabled and avatar looks like an R2 URL or contains uploads, prefer a signed URL
          if (objectStorage && objectStorage.enabled && (u.avatar.includes('/uploads/') )) {
            try {
              const fname = (u.avatar || '').split('/').pop();
              if (fname) avatar = objectStorage.getSignedUrl(`uploads/${fname}`);
              else avatar = u.avatar;
            } catch (e) {
              avatar = u.avatar;
            }
          } else avatar = u.avatar;
        } else if (u.avatar && u.avatar.startsWith('/uploads/')) {
          // check file exists locally
          const rel = u.avatar.startsWith('/') ? u.avatar.slice(1) : u.avatar;
          const abs = path.join(__dirname, '..', rel);
          try {
            if (fs.existsSync(abs)) avatar = origin + (u.avatar.startsWith('/') ? u.avatar : '/' + u.avatar);
            else {
              // if object storage enabled, try signed URL for the filename
              if (objectStorage && objectStorage.enabled) {
                const fname = (u.avatar || '').split('/').pop();
                if (fname) {
                  try { avatar = objectStorage.getSignedUrl(`uploads/${fname}`); } catch (e) { avatar = ''; }
                }
              } else avatar = '';
            }
          } catch (e) { avatar = ''; }
        } else avatar = '';
      }
      const out = Object.assign({}, u);
      out.avatar = avatar;
      out.pressRole = u.pressRole || '';
      delete out.avatarData;
      delete out.avatarMime;
      // include region in public response (if present)
      out.region = u.region || '';
      return out;
    });
    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Return current user's public info (requires auth)
router.get('/me', auth.verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    const out = user.toObject();
    out.avatar = avatar;
    // remove binary fields from API response to reduce payload
    delete out.avatarData;
    delete out.avatarMime;
    // include region for frontend
    out.region = user.region || '';
    // include display role for press card
    out.pressRole = user.pressRole || '';

    res.json({ success: true, data: out });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve a reporter
router.put('/reporters/:id/approve', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    user.isApproved = true;
    // set approvedAt to now (used for validity period)
    user.approvedAt = user.approvedAt || new Date();
    // ensure reporterId exists (should be set at registration but guard just in case)
    if (!user.reporterId) {
      user.reporterId = `RJ${Date.now().toString().slice(-6)}${Math.floor(Math.random()*900+100)}`;
    }

    await user.save();
    res.json({ success: true, message: 'Reporter approved', data: { id: user._id, isApproved: user.isApproved, reporterId: user.reporterId, approvedAt: user.approvedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete reporter
router.delete('/reporters/:id', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    await user.remove();
    res.json({ success: true, message: 'Reporter deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Public: reviewer card data (used to render press ID previews)
// Example: GET /api/users/reporters/:id/card
router.get('/reporters/:id/card', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, message: 'Bad request' });
    const user = await User.findById(id).select('-password');
    if (!user || user.role !== 'reporter') return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (!user.isApproved) return res.status(403).json({ success: false, message: 'Reporter not approved yet' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    // Calculate validity: 1 year from approvedAt (if approvedAt missing, use createdAt)
    const base = user.approvedAt || user.createdAt || new Date();
    const validUntil = new Date(base);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    res.json({
      success: true,
      data: {
        id: user.reporterId || '',
        name: user.name,
        avatar,
        approvedAt: user.approvedAt,
        validUntil: validUntil.toISOString(),
        roleLabel: user.pressRole && user.pressRole.trim() ? user.pressRole : 'Reporter',
        region: user.region || '',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
