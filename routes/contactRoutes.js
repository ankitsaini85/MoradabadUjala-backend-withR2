const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const { verifyToken, requireRole } = require('../middleware/auth');

// Public: submit contact form
router.post('/', async (req, res) => {
  try {
    const { name, email, mobile, address, message } = req.body;
    if (!name || !email || !mobile || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const contact = new Contact({ name, email, mobile, address, message });
    await contact.save();
    res.json({ success: true, message: 'Thank you — your message has been received', data: contact });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: list all contacts
router.get('/', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json({ success: true, data: contacts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
