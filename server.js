require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const upload = multer({ dest: '/tmp/videoai-uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TR_API = 'https://api.tokenrouter.com/v1/video/generations';

// R2 Client (lazy init — nunggu credential di .env)
let r2 = null;
function getR2() {
  if (r2) return r2;
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });
  return r2;
}

// API key dari frontend
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required. Set di halaman utama.' });
  req.trKey = apiKey;
  next();
});

// Submit generation
app.post('/api/generate', upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'audios', maxCount: 3 },
  { name: 'videos', maxCount: 3 },
  { name: 'firstFrame', maxCount: 1 },
  { name: 'lastFrame', maxCount: 1 }
]), async (req, res) => {
  try {
    const { prompt, duration, resolution, model } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt wajib diisi' });

    const payload = {
      model: model || 'kling-v3-omni',
      prompt,
      images: [],
      audios: [],
      videos: [],
      metadata: {}
    };

    const bucket = process.env.R2_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'R2_BUCKET belum diset di .env' });

    // Upload files ke R2
    if (req.files.images) payload.images = await uploadToR2(bucket, req.files.images);
    if (req.files.audios) payload.audios = await uploadToR2(bucket, req.files.audios);
    if (req.files.videos) payload.videos = await uploadToR2(bucket, req.files.videos);

    if (req.files.firstFrame) {
      const ff = await uploadToR2(bucket, req.files.firstFrame);
      payload.metadata.first_frame = ff[0];
      payload.images.push(ff[0]);
    }
    if (req.files.lastFrame) {
      const lf = await uploadToR2(bucket, req.files.lastFrame);
      payload.metadata.last_frame = lf[0];
      payload.images.push(lf[0]);
    }
    if (duration) payload.metadata.duration = parseInt(duration);
    if (resolution) payload.metadata.resolution = resolution;

    Object.keys(payload).forEach(k => {
      if (Array.isArray(payload[k]) && payload[k].length === 0) delete payload[k];
    });

    const result = await fetch(TR_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.trKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await result.json();
    res.json(data);

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Health check (for login validation)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Check task progress
app.get('/api/status/:taskId', async (req, res) => {
  try {
    const result = await fetch(`${TR_API}/${req.params.taskId}`, {
      headers: { 'Authorization': `Bearer ${req.trKey}` }
    });
    const data = await result.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload file ke R2, return public URL
async function uploadToR2(bucket, files) {
  const urls = [];
  const s3 = getR2();
  const publicUrl = process.env.R2_PUBLIC_URL || '';
  // fallback: construct from endpoint if custom domain not set
  const baseUrl = publicUrl
    ? publicUrl.replace(/\/$/, '')
    : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}`;

  for (const f of files) {
    const ext = path.extname(f.originalname) || '.bin';
    const key = `videoai/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const body = require('fs').readFileSync(f.path);

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: f.mimetype,
    }));

    urls.push(`${baseUrl}/${key}`);
    require('fs').unlinkSync(f.path);
  }
  return urls;
}

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log(`VideoAI running on http://localhost:${PORT}`));
