const fs = require('fs');
const AWS = require('aws-sdk');

// Cloudflare R2 / S3-compatible storage helper
// Enable by setting OBJECT_STORAGE=1 and R2_BUCKET in .env
// For Cloudflare R2 set R2_ENDPOINT to e.g. https://<accountid>.r2.cloudflarestorage.com

const enabled = Boolean(process.env.OBJECT_STORAGE && process.env.R2_BUCKET);
let s3 = null;
if (enabled) {
  const config = {};
  if (process.env.R2_ENDPOINT) {
    config.endpoint = process.env.R2_ENDPOINT.replace(/\/$/, '');
    config.s3ForcePathStyle = true;
  }
  // Ensure signature version v4 for Cloudflare R2 compatibility
  config.signatureVersion = 'v4';
  if (process.env.AWS_REGION) config.region = process.env.AWS_REGION;
  if (process.env.AWS_ACCESS_KEY_ID) config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  if (process.env.AWS_SECRET_ACCESS_KEY) config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  s3 = new AWS.S3(config);
}

function getBucket() {
  return process.env.R2_BUCKET;
}

function getPublicUrl(key) {
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
  const bucket = getBucket();
  // If a public R2 dev URL is provided (e.g. https://pub-...r2.dev) use it directly
  if (publicBase) {
    // Assume the public dev URL serves the bucket root (no bucket segment)
    const safeKey = String(key || '').split('/').map(encodeURIComponent).join('/');
    return `${publicBase}/${safeKey}`;
  }
  if (endpoint) {
    // encode each path segment but preserve slashes
    const safeKey = String(key || '').split('/').map(encodeURIComponent).join('/');
    return `${endpoint}/${bucket}/${safeKey}`;
  }
  return `https://${bucket}.s3.amazonaws.com/${encodeURIComponent(key)}`;
}

async function uploadFileFromPath(localPath, key) {
  if (!enabled) throw new Error('Object storage not enabled');
  if (!fs.existsSync(localPath)) throw new Error('Local file not found: ' + localPath);
  const Body = fs.createReadStream(localPath);
  const params = { Bucket: getBucket(), Key: key, Body };
  // Cloudflare R2 ignores ACL, but we leave it unless S3_NO_PUBLIC_ACL set
  if (!process.env.R2_NO_PUBLIC_ACL) params.ACL = 'public-read';
  return new Promise((resolve, reject) => {
    s3.upload(params, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

async function uploadBuffer(buffer, key, contentType) {
  if (!enabled) throw new Error('Object storage not enabled');
  const params = { Bucket: getBucket(), Key: key, Body: buffer };
  if (contentType) params.ContentType = contentType;
  if (!process.env.R2_NO_PUBLIC_ACL) params.ACL = 'public-read';
  return new Promise((resolve, reject) => {
    s3.upload(params, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

async function objectExists(key) {
  if (!enabled) return false;
  return new Promise((resolve) => {
    s3.headObject({ Bucket: getBucket(), Key: key }, (err, data) => {
      if (err) return resolve(false);
      return resolve(true);
    });
  });
}

function getSignedUrl(key, expiresSeconds = 900) {
  if (!enabled) throw new Error('Object storage not enabled');
  const params = { Bucket: getBucket(), Key: key, Expires: expiresSeconds };
  try {
    // s3.getSignedUrl is synchronous and returns a URL string
    return s3.getSignedUrl('getObject', params);
  } catch (e) {
    throw e;
  }
}

module.exports = { enabled, uploadFileFromPath, uploadBuffer, getPublicUrl, objectExists, getSignedUrl };
