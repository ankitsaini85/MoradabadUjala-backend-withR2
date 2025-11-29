require('dotenv').config();
const AWS = require('aws-sdk');

if (!process.env.R2_BUCKET) {
  console.error('Set R2_BUCKET in .env');
  process.exit(1);
}

const cfg = {};
if (process.env.R2_ENDPOINT) cfg.endpoint = process.env.R2_ENDPOINT.replace(/\/$/, '');
if (process.env.AWS_REGION) cfg.region = process.env.AWS_REGION;
if (process.env.AWS_ACCESS_KEY_ID) cfg.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
if (process.env.AWS_SECRET_ACCESS_KEY) cfg.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const s3 = new AWS.S3(cfg);

async function run() {
  const params = { Bucket: process.env.R2_BUCKET, Prefix: 'uploads/' };
  try {
    const res = await s3.listObjectsV2(params).promise();
    if (!res.Contents || res.Contents.length === 0) {
      console.log('No objects found under uploads/');
      return;
    }
    console.log('Objects under uploads/:');
    res.Contents.forEach(o => console.log('-', o.Key, o.Size));
  } catch (err) {
    console.error('List error:', err && err.message);
  }
}

run().catch(e=>console.error(e));
