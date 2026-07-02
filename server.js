require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: '/tmp/videoai-uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TR_API = 'https://api.tokenrouter.com/v1/video/generations';

// API key diambil dari request header, dikirim dari frontend (localStorage)
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
      model: model || 'dreamina-seedance-2-0-fast-260128',
      prompt,
      images: [],
      audios: [],
      videos: [],
      metadata: {}
    };

    // Upload files ke temp URL (simpan lokal, serve via nanti)
    if (req.files.images) payload.images = await uploadToTemp(req.files.images);
    if (req.files.audios) payload.audios = await uploadToTemp(req.files.audios);
    if (req.files.videos) payload.videos = await uploadToTemp(req.files.videos);

    if (req.files.firstFrame) {
      const ff = await uploadToTemp(req.files.firstFrame);
      payload.metadata.first_frame = ff[0];
      payload.images.push(ff[0]);
    }
    if (req.files.lastFrame) {
      const lf = await uploadToTemp(req.files.lastFrame);
      payload.metadata.last_frame = lf[0];
      payload.images.push(lf[0]);
    }
    if (duration) payload.metadata.duration = parseInt(duration);
    if (resolution) payload.metadata.resolution = resolution;

    // Remove empty arrays
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

// Upload file and return URL (base64 for simplicity since no CDN)
async function uploadToTemp(files) {
  const urls = [];
  for (const f of files) {
    const data = fs.readFileSync(f.path);
    const b64 = data.toString('base64');
    const mime = f.mimetype || 'application/octet-stream';
    urls.push(`data:${mime};base64,${b64}`);
    fs.unlinkSync(f.path);
  }
  return urls;
}

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log(`VideoAI running on http://localhost:${PORT}`));
