require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TR_API = 'https://api.tokenrouter.com/v1/video/generations';

// API key dari frontend (localStorage)
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  req.trKey = apiKey;
  next();
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Submit generation
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, duration, model, mode, aspectRatio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt wajib diisi' });

    const payload = {
      api_version: 'omni',
      model: model || 'kling-v3-omni',
      prompt,
      mode: mode || 'std',
      duration: String(duration || 5),
      aspect_ratio: aspectRatio || '16:9'
    };

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

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log(`VideoAI running on http://localhost:${PORT}`));
