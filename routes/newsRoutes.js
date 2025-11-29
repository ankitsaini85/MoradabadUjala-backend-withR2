const express = require('express');
const router = express.Router();
const newsAPIService = require('../services/newsAPIService');
const News = require('../models/News');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const objectStorage = require('../services/objectStorage');
const mongoose = require('mongoose');
const { verifyToken, requireRole } = require('../middleware/auth');

// Helper to build absolute URLs for uploaded files using configured SERVER_URL
function makeAbsoluteUrl(req, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
  const rel = p.startsWith('/') ? p : '/' + p;
  return origin + rel;
}

// Normalize media URLs in a news document for API responses.
function normalizeMedia(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc && doc.toObject ? doc.toObject() : doc);
  const makePublic = (p) => {
    if (!p) return p;
    if (/^https?:\/\//i.test(p)) {
      // If already absolute and points to uploads or to the public dev URL, convert to public URL
      if (objectStorage && objectStorage.enabled && (p.includes('/uploads/') || (process.env.R2_PUBLIC_URL && p.includes(process.env.R2_PUBLIC_URL)))) {
        const fname = p.split('/').pop();
        if (fname) return objectStorage.getPublicUrl(`uploads/${fname}`);
      }
      return p;
    }
    // local path like /uploads/...
    if (p.startsWith('/uploads/') || p.indexOf('/uploads/') >= 0) {
      const fname = p.split('/').pop();
      if (fname && objectStorage && objectStorage.enabled) return objectStorage.getPublicUrl(`uploads/${fname}`);
      return p;
    }
    return p;
  };

  out.imageUrl = makePublic(out.imageUrl || out.imagePath || '');
  out.videoUrl = makePublic(out.videoUrl || out.videoPath || '');
  if (Array.isArray(out.galleryImages)) {
    out.galleryImages = out.galleryImages.map(g => makePublic(g || ''));
  }
  return out;
}

// Multer setup: prefer memoryStorage when object storage is enabled (upload directly to R2),
// otherwise fallback to legacy diskStorage under public/uploads.
let upload;
if (objectStorage && objectStorage.enabled) {
  const memoryStorage = multer.memoryStorage();
  upload = multer({ storage: memoryStorage });
} else {
  const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      const dir = path.join(__dirname, '..', 'public', 'uploads');
      // ensure dir exists
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      cb(null, dir);
    },
    filename: function (req, file, cb) {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    }
  });
  upload = multer({ storage: diskStorage });
}

// Get all news with LIVE API fetching
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const category = req.query.category;
    const search = req.query.search;

    let news = [];

    // If search query, use search API
    if (search) {
      news = await newsAPIService.searchNews(search, limit);
    } 
    // If category specified, fetch for that category
    else if (category && category !== 'all') {
      news = await newsAPIService.fetchTopHeadlines(category, limit);
    } 
    // Default: fetch general/breaking news
    else {
      news = await newsAPIService.fetchTopHeadlines('india', limit);
    }

    // Simple client-side pagination (API returns limited results)
    const total = news.length;
    const startIndex = (page - 1) * limit;
    const paginatedNews = news.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paginatedNews,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
      source: 'live-api',
      message: 'Live news from GNews API'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message,
      hint: error.message.includes('API_KEY') 
        ? 'Add your GNews API key to backend/.env file' 
        : 'Check your internet connection or API key'
    });
  }
});

// Get breaking news (LIVE)
router.get('/breaking', async (req, res) => {
  try {
    const news = await newsAPIService.fetchBreakingNews(10);

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live breaking news from GNews'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- DB-backed Ujala/admin/superadmin endpoints ---

// Admin upload form endpoint (admin token required)
router.post('/admin/upload', verifyToken, requireRole('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'galleryImages', maxCount: 10 }]), async (req, res) => {
  try {
    const { title, description, content, author, location, type } = req.body;
    if (!title || !description || !content) return res.status(400).json({ success: false, message: 'Missing required fields' });

    // Create the News document first (without binary blobs) so we have an _id
    const news = new News({
      title,
      description,
      content,
      author: author || 'Moradabad Ujala Team',
      category: (type === 'gallery') ? 'ujala gallery' : (type === 'event') ? 'ujala events' : 'ujala',
      isUjala: true,
      isGallery: type === 'gallery',
      isEvent: type === 'event',
      approved: false,
      location: location || '',
    });

    await news.save();

    // handle files if provided (diskStorage provides filenames)
    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const gallery = Array.isArray(req.files.galleryImages) ? req.files.galleryImages : undefined;

      if (imageFile) {
        // If multer used memoryStorage (buffer present), upload buffer directly to object storage
        if (imageFile.buffer && objectStorage && objectStorage.enabled) {
          try {
            const ext = path.extname(imageFile.originalname || '') || '';
            const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
            const key = `uploads/${filename}`;
            await objectStorage.uploadBuffer(imageFile.buffer, key, imageFile.mimetype);
            news.imageUrl = objectStorage.getPublicUrl(key);
            news.imagePath = undefined;
          } catch (e) {
            console.warn('Failed to upload admin image buffer to object storage:', e && e.message);
            if (imageFile.filename) {
              news.imagePath = `/uploads/${imageFile.filename}`;
              news.imageUrl = makeAbsoluteUrl(req, news.imagePath);
            }
          }
        } else if (imageFile.filename) {
          news.imagePath = `/uploads/${imageFile.filename}`;
          news.imageUrl = makeAbsoluteUrl(req, news.imagePath);
          if (objectStorage && objectStorage.enabled) {
            try {
              const local = path.join(__dirname, '..', 'public', 'uploads', imageFile.filename);
              const key = `uploads/${imageFile.filename}`;
              await objectStorage.uploadFileFromPath(local, key);
              news.imageUrl = objectStorage.getPublicUrl(key);
              news.imagePath = undefined;
              try { fs.unlinkSync(local); } catch (e) { /* ignore */ }
            } catch (e) {
              console.warn('Failed to upload admin image to object storage:', e && e.message);
            }
          }
        }
      }
      if (gallery && gallery.length > 0) {
        news.galleryImages = gallery.map(f => (f.filename ? makeAbsoluteUrl(req, `/uploads/${f.filename}`) : (f.path || '')));
        if (objectStorage && objectStorage.enabled) {
          const newGallery = [];
          for (const f of gallery) {
            try {
              if (f.buffer) {
                const ext = path.extname(f.originalname || '') || '';
                const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
                const key = `uploads/${filename}`;
                await objectStorage.uploadBuffer(f.buffer, key, f.mimetype);
                newGallery.push(objectStorage.getPublicUrl(key));
              } else if (f.filename) {
                const local = path.join(__dirname, '..', 'public', 'uploads', f.filename);
                const key = `uploads/${f.filename}`;
                try {
                  await objectStorage.uploadFileFromPath(local, key);
                  newGallery.push(objectStorage.getPublicUrl(key));
                  try { fs.unlinkSync(local); } catch (e) { }
                } catch (e) {
                  console.warn('Failed to upload admin gallery file to object storage:', e && e.message);
                  newGallery.push(makeAbsoluteUrl(req, `/uploads/${f.filename}`));
                }
              }
            } catch (e) {
              console.warn('Failed to process gallery file', e && e.message);
            }
          }
          news.galleryImages = newGallery;
        }
      }

      await news.save();
    }
    // event-specific fields
    if (req.body.eventDate) {
      const d = new Date(req.body.eventDate);
      if (!isNaN(d)) news.eventDate = d;
    }
    if (req.body.eventVenue) news.eventVenue = req.body.eventVenue;

    await news.save();
    res.json({ success: true, message: 'News uploaded and pending approval', data: news });
  } catch (err) {
    console.error('Error in POST /reporter/upload', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Server error',
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {})
    });
  }
});

// Reporter upload endpoint (reporters submit news for approval)
router.post('/reporter/upload', verifyToken, requireRole(['reporter','admin']), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'galleryImages', maxCount: 10 }]), async (req, res) => {
  try {
    // Helpful debug logging for reporter uploads
    try {
      const fileSummary = {};
      if (req.files) {
        Object.keys(req.files).forEach((k) => {
          fileSummary[k] = Array.isArray(req.files[k]) ? req.files[k].map(f => f && f.filename) : [];
        });
      }
      console.log('Reporter upload request:', {
        body: {
          title: req.body && req.body.title,
          description: req.body && req.body.description,
          content: req.body && req.body.content,
          author: req.body && req.body.author,
          location: req.body && req.body.location,
          type: req.body && req.body.type,
        },
        user: req.user ? { id: req.user.id, name: req.user.name, roles: req.user.roles } : undefined,
        files: fileSummary,
      });
    } catch (logErr) {
      console.warn('Failed to log reporter upload request', logErr && logErr.message);
    }
    const { title, description, content, author, location, type } = req.body;
    if (!title || !description || !content) return res.status(400).json({ success: false, message: 'Missing required fields' });

    const news = new News({
      title,
      description,
      content,
      // prefer provided author, else use name from token if available
      author: author || (req.user && req.user.name) || 'Reporter',
      // reporters can submit normal ujala, gallery, or event; use Moradabad ujala naming
      category: (type === 'gallery') ? 'ujala gallery' : (type === 'event') ? 'ujala events' : 'Moradabad ujala',
      isUjala: true,
      isGallery: type === 'gallery',
      isEvent: type === 'event',
      approved: false,
      location: location || '',
    });

    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const videoFile = Array.isArray(req.files.video) ? req.files.video[0] : undefined;
      const gallery = Array.isArray(req.files.galleryImages) ? req.files.galleryImages : undefined;

      // Handle image (memory buffer preferred when objectStorage enabled)
      if (imageFile) {
        if (imageFile.buffer && objectStorage && objectStorage.enabled) {
          try {
            const ext = path.extname(imageFile.originalname || '') || '';
            const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
            const key = `uploads/${filename}`;
            await objectStorage.uploadBuffer(imageFile.buffer, key, imageFile.mimetype);
            news.imageUrl = objectStorage.getPublicUrl(key);
            news.imagePath = undefined;
          } catch (e) {
            console.warn('Failed to upload reporter image buffer to object storage:', e && e.message);
            if (imageFile.filename) {
              news.imagePath = `/uploads/${imageFile.filename}`;
              news.imageUrl = makeAbsoluteUrl(req, news.imagePath);
            }
          }
        } else if (imageFile.filename) {
          news.imagePath = `/uploads/${imageFile.filename}`;
          news.imageUrl = makeAbsoluteUrl(req, news.imagePath);
        }
      }

      // Handle video
      if (videoFile) {
        if (videoFile.buffer && objectStorage && objectStorage.enabled) {
          try {
            const ext = path.extname(videoFile.originalname || '') || '';
            const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
            const key = `uploads/${filename}`;
            await objectStorage.uploadBuffer(videoFile.buffer, key, videoFile.mimetype);
            news.videoUrl = objectStorage.getPublicUrl(key);
            news.videoPath = undefined;
          } catch (e) {
            console.warn('Failed to upload reporter video buffer to object storage:', e && e.message);
            if (videoFile.filename) {
              news.videoPath = `/uploads/${videoFile.filename}`;
              news.videoUrl = makeAbsoluteUrl(req, news.videoPath);
            }
          }
        } else if (videoFile.filename) {
          news.videoPath = `/uploads/${videoFile.filename}`;
          news.videoUrl = makeAbsoluteUrl(req, news.videoPath);
        }
      }

      // Handle gallery
      if (gallery && gallery.length > 0) {
        news.galleryImages = gallery.map(f => (f.filename ? makeAbsoluteUrl(req, `/uploads/${f.filename}`) : (f.path || '')));
        if (objectStorage && objectStorage.enabled) {
          const newGallery = [];
          for (const f of gallery) {
            try {
              if (f.buffer) {
                const ext = path.extname(f.originalname || '') || '';
                const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
                const key = `uploads/${filename}`;
                await objectStorage.uploadBuffer(f.buffer, key, f.mimetype);
                newGallery.push(objectStorage.getPublicUrl(key));
              } else if (f.filename) {
                const local = path.join(__dirname, '..', 'public', 'uploads', f.filename);
                const key = `uploads/${f.filename}`;
                try {
                  await objectStorage.uploadFileFromPath(local, key);
                  newGallery.push(objectStorage.getPublicUrl(key));
                  try { fs.unlinkSync(local); } catch (e) { }
                } catch (e) {
                  console.warn('Failed to upload gallery file to object storage:', e && e.message);
                  newGallery.push(makeAbsoluteUrl(req, `/uploads/${f.filename}`));
                }
              }
            } catch (e) {
              console.warn('Failed to process gallery file', e && e.message);
            }
          }
          news.galleryImages = newGallery;
        }
      }

      // If objectStorage enabled and some files were left as local (because buffer not present), attempt to upload them
      if (objectStorage && objectStorage.enabled) {
        try {
          if (!news.imageUrl && imageFile && imageFile.filename) {
            const local = path.join(__dirname, '..', 'public', 'uploads', imageFile.filename);
            const key = `uploads/${imageFile.filename}`;
            try { await objectStorage.uploadFileFromPath(local, key); news.imageUrl = objectStorage.getPublicUrl(key); news.imagePath = undefined; try { fs.unlinkSync(local); } catch (e) {} } catch (e) { console.warn('Failed to upload image to object storage:', e && e.message); }
          }
          if (!news.videoUrl && videoFile && videoFile.filename) {
            const local = path.join(__dirname, '..', 'public', 'uploads', videoFile.filename);
            const key = `uploads/${videoFile.filename}`;
            try { await objectStorage.uploadFileFromPath(local, key); news.videoUrl = objectStorage.getPublicUrl(key); news.videoPath = undefined; try { fs.unlinkSync(local); } catch (e) {} } catch (e) { console.warn('Failed to upload video to object storage:', e && e.message); }
          }
        } catch (e) {
          console.warn('Error while uploading leftover files to object storage:', e && e.message);
        }
      }

      await news.save();
    }
    // event-specific fields
    if (req.body.eventDate) {
      const d = new Date(req.body.eventDate);
      if (!isNaN(d)) news.eventDate = d;
    }
    if (req.body.eventVenue) news.eventVenue = req.body.eventVenue;

    // Attach reporter id if available
    if (req.user && req.user.id) news.reporterId = req.user.id;

    try {
      await news.save();
      return res.json({ success: true, message: 'News submitted and pending approval', data: news });
    } catch (saveErr) {
      console.error('Error saving reporter-submitted news', saveErr);
      // Handle duplicate key (e.g., slug) more gracefully
      if (saveErr && saveErr.code === 11000) {
        return res.status(409).json({ success: false, message: 'Duplicate key error: an item with similar slug already exists', error: saveErr.message });
      }
      return res.status(500).json({
        success: false,
        message: saveErr.message || 'Server error while saving news',
        ...(process.env.NODE_ENV !== 'production' ? { stack: saveErr.stack } : {}),
      });
    }
  } catch (err) {
    console.error('Unexpected error in /reporter/upload handler', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Server error',
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
    });
  }
});

// Public ujala listing (only approved items)
router.get('/ujala', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    // List any item that has been marked as Ujala and approved — don't rely on category string
    const query = { isUjala: true, approved: true };
    const total = await News.countDocuments(query);
    // sort breaking items first, then by newest
    const docs = await News.find(query)
      .sort({ isBreaking: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ success: true, data: docs.map(normalizeMedia), pagination: { total, page, pages: Math.ceil(total / limit), limit }, source: 'database' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public ujala events listing (only approved event items)
router.get('/ujala-events', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const query = { isUjala: true, approved: true, isEvent: true };
    const total = await News.countDocuments(query);
    const docs = await News.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ success: true, data: docs.map(normalizeMedia), pagination: { total, page, pages: Math.ceil(total / limit), limit }, source: 'database' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public share preview page for social platforms (Open Graph meta tags)
// Example: GET /api/news/share/:slug
// Serve image media for a news item (disk-based)
router.get('/media/:id/image', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Bad Request');
    const item = await News.findById(id).select('imagePath imageUrl');
    if (!item) return res.status(404).send('Not found');
            // prefer external absolute URL — but if it's an R2/public URL and object storage is enabled, don't redirect straight to the stored public URL; instead generate a signed URL for the object
            if (item.imageUrl && /^https?:\/\//i.test(item.imageUrl)) {
              if (objectStorage && objectStorage.enabled && (item.imageUrl.includes('/uploads/') || (process.env.R2_PUBLIC_URL && item.imageUrl.includes(process.env.R2_PUBLIC_URL)))) {
                const fname = (item.imageUrl || '').split('/').pop();
                if (fname) {
                  const key = `uploads/${fname}`;
                  try {
                    const url = objectStorage.getSignedUrl ? objectStorage.getSignedUrl(key) : objectStorage.getPublicUrl(key);
                    return res.redirect(302, url);
                  } catch (e) {
                    return res.redirect(302, objectStorage.getPublicUrl(key));
                  }
                }
              }
              return res.redirect(302, item.imageUrl);
    }
    // If imageUrl is a local path (e.g. '/uploads/filename') and object storage is enabled, try R2 first
    if (item.imageUrl && !/^https?:\/\//i.test(item.imageUrl) && objectStorage && objectStorage.enabled) {
      const fname = (item.imageUrl || '').split('/').pop();
          if (fname) {
        const key = `uploads/${fname}`;
        try {
          const exists = await objectStorage.objectExists(key);
          if (exists) {
            try {
              const url = objectStorage.getSignedUrl(key);
              return res.redirect(302, url);
            } catch (e) {
              return res.redirect(302, objectStorage.getPublicUrl(key));
            }
          }
        } catch (e) {
          console.warn('Error checking object existence for', key, e && e.message);
        }
      }
    }
    if (item.imagePath) {
      // If object storage enabled, try R2 first and verify object exists
      if (objectStorage && objectStorage.enabled) {
        const fname = (item.imagePath || '').split('/').pop();
        if (fname) {
          const key = `uploads/${fname}`;
          try {
            const exists = await objectStorage.objectExists(key);
            if (exists) {
              try {
                const url = objectStorage.getSignedUrl(key);
                return res.redirect(302, url);
              } catch (e) {
                return res.redirect(302, objectStorage.getPublicUrl(key));
              }
            }
          } catch (e) {
            console.warn('Error checking object existence for', key, e && e.message);
          }
        }
      }
      const rel = item.imagePath.startsWith('/') ? item.imagePath.slice(1) : item.imagePath;
      const fp = path.join(__dirname, '..', 'public', rel);
      if (fs.existsSync(fp)) return res.sendFile(fp);
      // missing local file and no R2 object -> return placeholder
      const fallback = (process.env.DEFAULT_OG_IMAGE || '') || '/placeholder.svg';
      if (/^https?:\/\//i.test(fallback)) return res.redirect(302, fallback);
      return res.sendFile(path.join(__dirname, '..', 'public', fallback.startsWith('/') ? fallback.slice(1) : fallback));
    }
    return res.status(404).send('No image');
  } catch (err) {
    console.error('Error serving /media/:id/image', err);
    return res.status(500).send('Server error');
  }
});

// Serve gallery image by index
router.get('/media/:id/gallery/:idx', async (req, res) => {
  try {
    const id = req.params.id;
    const idx = parseInt(req.params.idx || '0', 10);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Bad Request');
    const item = await News.findById(id).select('galleryImages');
    if (!item) return res.status(404).send('Not found');
    if (Array.isArray(item.galleryImages) && item.galleryImages[idx]) {
      const url = item.galleryImages[idx];
      if (/^https?:\/\//i.test(url)) {
        if (objectStorage && objectStorage.enabled && (url.includes('/uploads/') || (process.env.R2_PUBLIC_URL && url.includes(process.env.R2_PUBLIC_URL)))) {
          const fname = (url || '').split('/').pop();
          if (fname) {
            const key = `uploads/${fname}`;
            try {
              const redirectUrl = objectStorage.getSignedUrl ? objectStorage.getSignedUrl(key) : objectStorage.getPublicUrl(key);
              return res.redirect(302, redirectUrl);
            } catch (e) {
              return res.redirect(302, objectStorage.getPublicUrl(key));
            }
          }
        }
        return res.redirect(302, url);
      }
      // local path — if object storage enabled, try R2 first (verify existence)
      if (objectStorage && objectStorage.enabled) {
        const fname = (url || '').split('/').pop();
        if (fname) {
          const key = `uploads/${fname}`;
          try {
            const exists = await objectStorage.objectExists(key);
            if (exists) return res.redirect(302, objectStorage.getPublicUrl(key));
          } catch (e) {
            console.warn('Error checking gallery object existence for', key, e && e.message);
          }
        }
      }
      const rel = url.startsWith('/') ? url.slice(1) : url;
      const fp = path.join(__dirname, '..', 'public', rel);
      if (fs.existsSync(fp)) return res.sendFile(fp);
      const fallback = (process.env.DEFAULT_OG_IMAGE || '') || '/placeholder.svg';
      if (/^https?:\/\//i.test(fallback)) return res.redirect(302, fallback);
      return res.sendFile(path.join(__dirname, '..', 'public', fallback.startsWith('/') ? fallback.slice(1) : fallback));
    }
    return res.status(404).send('No image');
  } catch (err) {
    console.error('Error serving /media/:id/gallery/:idx', err);
    return res.status(500).send('Server error');
  }
});
router.get('/share/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '');
    if (!rawSlug) return res.status(400).send('Bad Request');

    const item = await News.findOne({ slug: rawSlug });
    if (!item) return res.status(404).send('Not found');

    // derive origin (prefer configured SERVER_URL for production)
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;

    const makeAbsolute = (p) => {
      if (!p) return '';
      if (/^https?:\/\//i.test(p)) return p;
      const path = p.startsWith('/') ? p : '/' + p;
      return origin + path;
    };

    const title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const description = (item.description || item.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const frontendBase = (process.env.FRONTEND_URL || origin).replace(/\/$/, '');
    const pageUrl = frontendBase + `/news/${item.slug}`;

    // Determine fallback OG image: preference order -> item image/video thumbnail -> configured DEFAULT_OG_IMAGE -> a placeholder under public
    const defaultOg = (process.env.DEFAULT_OG_IMAGE || '').trim();
    let image = makeAbsolute(item.imageUrl || item.imagePath || '');
    if (!image && defaultOg) image = makeAbsolute(defaultOg);
    if (!image) image = makeAbsolute('/placeholder.svg');
    const video = makeAbsolute(item.videoUrl || item.videoPath || '');

    const isVideo = Boolean(item.videoUrl || item.videoPath);

    // minimal HTML with OG tags — social platforms will fetch these when a URL is shared
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta property="og:site_name" content="Moradabad Ujala" />
  <meta name="twitter:site" content="@MoradabadUjala" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:type" content="${isVideo ? 'video.other' : 'article'}" />
  ${image ? `<meta property="og:image" content="${image}" />` : ''}
  ${image ? `<meta name="twitter:image" content="${image}" />` : ''}
  ${isVideo ? `<meta property="og:video" content="${video}" />` : ''}
  ${isVideo ? `<meta property="og:video:secure_url" content="${video}" />` : ''}
  ${isVideo ? `<meta property="og:video:type" content="video/mp4" />` : ''}
  <meta name="twitter:card" content="${isVideo ? 'player' : 'summary_large_image'}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:url" content="${pageUrl}" />
  <link rel="canonical" href="${pageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${pageUrl}">${pageUrl}</a></p>
  <script>try{location.replace('${pageUrl}')}catch(e){}</script>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error in /share/:slug', err);
    res.status(500).send('Server error');
  }
});

// Superadmin: list pending approvals (superadmin token required)
router.get('/superadmin/approval', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const pending = await News.find({ isUjala: true, approved: false }).sort({ createdAt: -1 });
    res.json({ success: true, data: pending.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: list pending gallery submissions
router.get('/superadmin/approval/gallery', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const pending = await News.find({ isUjala: true, approved: false, isGallery: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: pending.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: list pending event submissions
router.get('/superadmin/approval/events', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const pending = await News.find({ isUjala: true, approved: false, isEvent: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: pending.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: approve a news item
router.put('/superadmin/approval/:id/approve', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    // mark as approved and ensure it is categorized correctly for ujala
    item.approved = true;
    item.isUjala = true;
    // If this news was created by a reporter, keep/set the category to 'Moradabad ujala'
    // Also, if category was already a ujala-like value, normalize to 'Moradabad ujala'.
    try {
      const existingCat = (item.category || '').toString().trim();
      // For gallery/event keep explicit categories
      if (item.isGallery) {
        item.category = 'ujala gallery';
      } else if (item.isEvent) {
        item.category = 'ujala events';
      } else if (!existingCat) {
        // Only set default when no category was provided by submitter
        item.category = 'Moradabad ujala';
      }
      // If an uploader (reporter/admin) provided a category, preserve it as-is.
    } catch (e) {
      // Keep any existing category if possible, otherwise set sensible default
      item.category = item.category || 'Moradabad ujala';
    }
    // mark as breaking so it appears at top of ujala listing
    item.isBreaking = true;
    await item.save();
    res.json({ success: true, message: 'News approved', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: approve a gallery item explicitly
router.put('/superadmin/approval/:id/approve/gallery', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.approved = true;
    item.isUjala = true;
    item.isGallery = true;
    item.isEvent = false;
    item.category = 'ujala gallery';
    item.isBreaking = true;
    await item.save();
    res.json({ success: true, message: 'Gallery approved', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: approve an event item explicitly
router.put('/superadmin/approval/:id/approve/event', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.approved = true;
    item.isUjala = true;
    item.isEvent = true;
    item.isGallery = false;
    item.category = 'ujala events';
    item.isBreaking = true;
    await item.save();
    res.json({ success: true, message: 'Event approved', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: list all approved ujala news (for management)
router.get('/admin/approved-news', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const items = await News.find({ isUjala: true, approved: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: items.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin (and superadmin): list all approved ujala gallery items
router.get('/admin/approved-gallery', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const items = await News.find({ isUjala: true, approved: true, isGallery: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: items.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin (and superadmin): list all approved ujala event items
router.get('/admin/approved-events', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const items = await News.find({ isUjala: true, approved: true, isEvent: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: items.map(normalizeMedia) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: mark an approved news as featured (show on home)
router.put('/admin/approved-news/:id/feature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = true;
    item.featuredAt = new Date();
    await item.save();
    res.json({ success: true, message: 'Marked as featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: unmark featured
router.put('/admin/approved-news/:id/unfeature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = false;
    item.featuredAt = undefined;
    await item.save();
    res.json({ success: true, message: 'Removed from featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin/Superadmin: mark an approved gallery as featured (show on home)
router.put('/admin/approved-gallery/:id/feature', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = true;
    item.featuredAt = new Date();
    await item.save();
    res.json({ success: true, message: 'Marked as featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin/Superadmin: unmark gallery featured
router.put('/admin/approved-gallery/:id/unfeature', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = false;
    item.featuredAt = undefined;
    await item.save();
    res.json({ success: true, message: 'Removed from featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin/Superadmin: delete approved gallery
router.delete('/admin/approved-gallery/:id', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // best-effort cleanup of media files
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => { if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message); });
      };
      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
      // Remove any gallery images
      try {
        if (Array.isArray(item.galleryImages)) {
          item.galleryImages.forEach(p => unlinkIfExists(p));
        }
      } catch (e) {
        console.warn('Failed unlinking gallery images', e && e.message);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup error after deleting approved gallery', cleanupErr.message || cleanupErr);
    }

    res.json({ success: true, message: 'Approved gallery deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin/Superadmin: delete approved event
router.delete('/admin/approved-events/:id', verifyToken, requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // best-effort cleanup of media files
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => { if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message); });
      };
      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
      // Remove any gallery images
      try {
        if (Array.isArray(item.galleryImages)) {
          item.galleryImages.forEach(p => unlinkIfExists(p));
        }
      } catch (e) {
        console.warn('Failed unlinking gallery images', e && e.message);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup error after deleting approved event', cleanupErr.message || cleanupErr);
    }

    res.json({ success: true, message: 'Approved event deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: delete an approved news (admin management)
router.delete('/admin/approved-news/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // best-effort cleanup of media files
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => { if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message); });
      };
      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
      // Remove any gallery images
      try {
        if (Array.isArray(item.galleryImages)) {
          item.galleryImages.forEach(p => unlinkIfExists(p));
        }
      } catch (e) {
        console.warn('Failed unlinking gallery images', e && e.message);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup error after deleting approved news', cleanupErr.message || cleanupErr);
    }

    res.json({ success: true, message: 'Approved news deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public: DB-backed featured list (approved & admin-marked featured)
router.get('/featured-db', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const items = await News.find({ isUjala: true, approved: true, isFeatured: true })
      // sort by when it was marked featured (newest first), fallback to createdAt
      .sort({ featuredAt: -1, createdAt: -1 })
      .limit(limit);
    res.json({ success: true, data: items, source: 'database' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update a news item (admin or superadmin) - supports replacing image
// Allow admins to update news and replace image/video/gallery files
router.put('/:id', verifyToken, requireRole('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'galleryImages', maxCount: 10 }]), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    const { title, description, content, author, location, category } = req.body;
    if (title) item.title = title;
    if (description) item.description = description;
    if (content) item.content = content;
    if (author) item.author = author;
    if (location) item.location = location;
    if (category) item.category = category;

    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const videoFile = Array.isArray(req.files.video) ? req.files.video[0] : undefined;
      const gallery = Array.isArray(req.files.galleryImages) ? req.files.galleryImages : undefined;
      if (imageFile) {
        item.imagePath = `/uploads/${imageFile.filename}`;
        item.imageUrl = makeAbsoluteUrl(req, item.imagePath);
      }
      if (videoFile) {
        item.videoPath = `/uploads/${videoFile.filename}`;
        item.videoUrl = makeAbsoluteUrl(req, item.videoPath);
      }
      if (gallery && gallery.length > 0) {
        const newPaths = gallery.map(f => makeAbsoluteUrl(req, `/uploads/${f.filename}`));
        item.galleryImages = newPaths;
      }
    }

    await item.save();
    res.json({ success: true, message: 'News updated', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete a news item (superadmin only)
router.delete('/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;

    // Validate ObjectId early to avoid confusing CastError stack traces
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    // Use findByIdAndDelete for a single atomic operation
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // Best-effort: remove associated files from disk (imagePath / videoPath)
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        // urlPath may be like '/uploads/xxx.jpg' or just a relative path
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => {
          if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message);
        });
      };

      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
      // Remove any gallery images
      try {
        if (Array.isArray(item.galleryImages)) {
          item.galleryImages.forEach(p => unlinkIfExists(p));
        }
      } catch (e) {
        console.warn('Failed unlinking gallery images', e && e.message);
      }
    } catch (unlinkErr) {
      // Don't fail the whole request if file deletion has issues; just log
      console.warn('Error while trying to remove media files for deleted news', unlinkErr);
    }

    res.json({ success: true, message: 'News deleted' });
  } catch (err) {
    console.error('Error in DELETE /api/news/:id', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get featured news (LIVE)
router.get('/featured', async (req, res) => {
  try {
    // If no API key is configured, return an empty array instead of failing
    if (!newsAPIService.apiKey) {
      console.warn('No NEWS_API_KEY configured; /api/news/featured returning empty list');
      return res.json({ success: true, data: [], source: 'live-api', message: 'No API key configured; returning empty featured list' });
    }

    const news = await newsAPIService.fetchFeaturedNews(6);

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live featured news from multiple categories'
    });
  } catch (error) {
    console.error('Error in GET /api/news/featured', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get trending news (LIVE - mix of categories)
router.get('/trending', async (req, res) => {
  try {
    // Fetch from popular categories
    const [sports, entertainment, business] = await Promise.all([
      newsAPIService.fetchTopHeadlines('sports', 4),
      newsAPIService.fetchTopHeadlines('entertainment', 3),
      newsAPIService.fetchTopHeadlines('business', 3)
    ]);

    const news = [...sports, ...entertainment, ...business];

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live trending news from popular categories'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single news by slug (Note: For live API, we don't have individual article endpoints)
// This will search for the article title in the API
router.get('/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '');

    // Try DB first (for ujala or any saved news)
    try {
      const dbItem = await News.findOne({ slug: rawSlug });
      if (dbItem) {
        // If it's a ujala item and not approved, treat as not found
        if (dbItem.isUjala && !dbItem.approved) {
          return res.status(404).json({ success: false, message: 'News not found' });
        }

          // Return the document without incrementing here. Use dedicated endpoint to increment views
          return res.json({ success: true, data: dbItem, source: 'database', message: 'News detail from database' });
      }
    } catch (dbErr) {
      // continue to live API search if DB lookup fails
      console.warn('DB lookup failed for slug:', rawSlug, dbErr.message || dbErr);
    }

    // If we have a cached live-article for this slug, return it immediately
    const cached = newsAPIService.getArticleBySlug(rawSlug);
    if (cached) {
      return res.json({ success: true, data: cached, source: 'live-cache', message: 'Live article from cache' });
    }

    // Split into tokens and sanitize
    const tokens = rawSlug
      .split('-')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    // Keep tokens that contain at least 3 letters (Latin or Devanagari) to avoid numeric-only queries
    const goodTokens = tokens.filter((t) => /([A-Za-z]{3,}|[\u0900-\u097F]{3,})/.test(t));

    // Take up to 4 tokens to build a concise search term
    const searchTerm = goodTokens.slice(0, 4).join(' ').trim();

    if (!searchTerm) {
      // Can't form a valid search query from slug — avoid calling external API with bad query
      console.warn('Slug to searchTerm produced no valid tokens:', { rawSlug, tokens, goodTokens });
      return res.status(404).json({ success: false, message: 'News not found' });
    }

    // Perform live search using sanitized term
    const results = await newsAPIService.searchNews(searchTerm, 1);

    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: 'News not found' });
    }

    res.json({ success: true, data: results[0], source: 'live-api', message: 'Live news detail' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear cache endpoint (optional - for manual refresh)
router.post('/cache/clear', (req, res) => {
  try {
    newsAPIService.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Increment views for a news item (id-based). This endpoint is intentionally
// separate from the GET detail endpoint to avoid duplicate increments due to
// client-side duplicate requests (eg. React StrictMode double-mounts).
router.post('/:id/view', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const updated = await News.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { views: updated.views } });
  } catch (err) {
    console.error('Error incrementing views', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

