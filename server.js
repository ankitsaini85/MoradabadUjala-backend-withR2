require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/database');

const newsRoutes = require('./routes/newsRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const authRoutes = require('./routes/authRoutes');
const contactRoutes = require('./routes/contactRoutes');
const userRoutes = require('./routes/userRoutes');
const path = require('path');
const News = require('./models/News');
const objectStorage = require('./services/objectStorage');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Ensure uploads directory exists to avoid multer errors when saving files
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
  }
} catch (e) {
  console.warn('Could not create uploads directory:', uploadsDir, e && e.message);
}

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "http://moradabadujala.in","https://moradabadujala.in"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Moradabad Ujala News',
    endpoints: {
      news: '/api/news',
      categories: '/api/categories',
      breaking: '/api/news/breaking',
      featured: '/api/news/featured',
      trending: '/api/news/trending',
    },
  });
});

app.use('/api/news', newsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', userRoutes);

// Image proxy to avoid browser CORS issues when fetching images from R2/public dev URLs
// Usage: GET /api/images/proxy?key=uploads/filename.jpg  OR  /api/images/proxy?url=https://...
app.get('/api/images/proxy', async (req, res) => {
  try {
    const axios = require('axios');
    const { key, url } = req.query;
    if (!key && !url) return res.status(400).json({ success: false, message: 'key or url required' });
    let target;
    if (key) {
      if (!objectStorage || !objectStorage.enabled) return res.status(400).json({ success: false, message: 'Object storage not enabled' });
      const safeKey = String(key).replace(/^\//, '');
      target = objectStorage.getPublicUrl(safeKey);
    } else {
      target = String(url);
    }

    // Fetch the image server-side and stream it to the client with CORS headers
    const resp = await axios.get(target, { responseType: 'stream', timeout: 15000 });
    // Pass through content-type and cache headers when present
    if (resp.headers['content-type']) res.setHeader('Content-Type', resp.headers['content-type']);
    if (resp.headers['cache-control']) res.setHeader('Cache-Control', resp.headers['cache-control']);
    // Always allow CORS for this proxy (frontend will still validate auth where needed)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Cache-Control');
    resp.data.pipe(res);
  } catch (err) {
    console.warn('Image proxy error', err && err.message);
    // Return a 502 so callers can fallback to placeholder
    return res.status(502).json({ success: false, message: 'Failed to fetch image' });
  }
});

// Attempt to redirect missing legacy /uploads requests to DB-backed media endpoints
// This helps when older records reference files that were migrated to DB blobs
app.use('/uploads/:file(*)', async (req, res, next) => {
  try {
    const filename = String(req.params.file || '').trim();
    if (!filename) return next();
    // Ignore obviously-broken filenames to avoid redirect loops (e.g. 'undefined')
    if (filename.toLowerCase().includes('undefined')) return next();
    const filePath = path.join(__dirname, 'public', 'uploads', filename);
    // If file exists on disk, let static middleware handle it
    if (fs.existsSync(filePath)) return next();

    // Try to find a News item that references this filename in imagePath/imageUrl/galleryImages
    // Use a simple substring match on the filename to locate candidates
    const regex = new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const item = await News.findOne({
      $or: [
        { imagePath: { $regex: regex } },
        { imageUrl: { $regex: regex } },
        { galleryImages: { $regex: regex } },
      ],
    }).lean();

    if (item) {
      console.log(`Redirecting missing upload '${filename}' to media for item ${item._id}`);
      // Prefer gallery match (find exact index), otherwise serve image media endpoint
      if (Array.isArray(item.galleryImages)) {
        const idx = item.galleryImages.findIndex(u => !!u && u.includes(filename));
        if (idx >= 0) return res.redirect(302, `/api/news/media/${item._id}/gallery/${idx}`);
      }
      return res.redirect(302, `/api/news/media/${item._id}/image`);
    }
  } catch (e) {
    console.warn('Error while redirecting missing upload:', e && e.message);
  }
  return next();
});

// Serve uploads: when object storage enabled, redirect requests to R2 public URL
if (objectStorage && objectStorage.enabled) {
  app.use('/uploads/:file(*)', (req, res) => {
    try {
      const filename = String(req.params.file || '').trim();
      if (!filename) return res.status(400).send('Bad Request');
      // map to R2 key and return a presigned URL so objects can be private
      const key = `uploads/${filename}`;
      try {
        // If a public dev URL is configured, prefer it (public access).
        if (process.env.R2_PUBLIC_URL) {
          return res.redirect(302, objectStorage.getPublicUrl(key));
        }
        const url = objectStorage.getSignedUrl(key);
        return res.redirect(302, url);
      } catch (e) {
        // fallback to public URL if signing fails
        return res.redirect(302, objectStorage.getPublicUrl(key));
      }
    } catch (e) {
      console.warn('Error redirecting upload to object storage:', e && e.message);
      return res.status(500).send('Server error');
    }
  });
} else {
  // Serve uploads statically when using local disk
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
}

// Legacy share redirects: support old shared links that omit the /api/news prefix
// Redirect `/share/:slug` -> `/api/news/share/:slug`
app.get('/share/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).send('Bad Request');
    return res.redirect(301, `/api/news/share/${encodeURIComponent(slug)}`);
  } catch (err) {
    return res.status(500).send('Server error');
  }
});

// Short share redirect: /r/:short -> backend share preview (/api/news/share/:slug)
app.get('/r/:short', async (req, res) => {
  try {
    const short = String(req.params.short || '').trim();
    if (!short) return res.status(400).send('Bad Request');
    const item = await News.findOne({ shortId: short }).select('slug');
    if (!item) return res.redirect(302, '/');
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    return res.redirect(301, `${origin}/api/news/share/${encodeURIComponent(item.slug)}`);
  } catch (err) {
    console.error('Error in /r/:short redirect', err);
    return res.status(500).send('Server error');
  }
});

// Support frontend builds that may call `/api/share/:slug` (missing `/news` segment)
app.get('/api/share/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ success: false, message: 'Bad Request' });
    return res.redirect(301, `/api/news/share/${encodeURIComponent(slug)}`);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API documentation: http://localhost:${PORT}`);
});
