const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = {};

auth.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'strong_secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// roleOrArray can be a single role string or an array of allowed roles
auth.requireRole = (roleOrArray) => {
  const allowed = Array.isArray(roleOrArray) ? roleOrArray : [roleOrArray];
  return (req, res, next) => {
    // req.user should be set by verifyToken
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized: no user context' });
    const foundRole = req.user.role || null;
    // allow superadmin to access anything
    if (foundRole === 'superadmin') return next();
    // allow if user's role is in allowed list
    if (foundRole && allowed.includes(foundRole)) return next();
    return res.status(403).json({ success: false, message: 'Forbidden: insufficient role', foundRole, required: allowed });
  };
};

module.exports = auth;
