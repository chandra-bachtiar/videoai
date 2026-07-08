require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TR_API = 'https://api.tokenrouter.com/v1/video/generations';

// Model config — each model knows its payload format
const MODEL_CONFIG = {
  'happyhorse-1.0-t2v': {
    buildPayload(p, d, m, a, size) {
      return { model: 'happyhorse-1.0-t2v', prompt: p, size: size || '1920*1080', duration: Number(d || 5), metadata: {} };
    }
  },
  'kling-v3-omni': {
    buildPayload(p, d, m, a) {
      const pld = { api_version:'omni', model:'kling-v3-omni', prompt:p, mode:m||'std', duration:String(d||5) };
      if (a) pld.aspect_ratio = a;
      return pld;
    }
  },
  'kling-3.0-turbo': {
    buildPayload(p, d, m, a) {
      const pld = { api_version:'turbo', model:'kling-3.0-turbo', prompt:p, metadata:{ settings:{ duration:Number(d||10) } } };
      if (a) pld.metadata.settings.aspect_ratio = a;
      return pld;
    }
  },
  'kling-v3': {
    buildPayload(p, d, m, a) {
      const pld = { api_version:'v3', model:'kling-v3', prompt:p, mode:m||'std', duration:String(d||5) };
      if (a) pld.aspect_ratio = a;
      return pld;
    }
  },
  'kling-v2-6': {
    buildPayload(p, d, m, a) {
      const pld = { api_version:'v2.6', model:'kling-v2-6', prompt:p, mode:m||'std', duration:String(d||5) };
      if (a) pld.aspect_ratio = a;
      return pld;
    }
  },
  'MiniMax-Hailuo-2.3': {
    buildPayload(p, d, m, a) {
      const pld = { api_version:'hailuo', model:'MiniMax-Hailuo-2.3', prompt:p, duration:String(d||5) };
      if (a) pld.aspect_ratio = a;
      return pld;
    }
  }
};

// API key dari frontend
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  req.trKey = apiKey;
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Submit generation
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, duration, model, mode, aspectRatio, size } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt wajib diisi' });

    const cfg = MODEL_CONFIG[model] || MODEL_CONFIG['happyhorse-1.0-t2v'];
    const payload = cfg.buildPayload(prompt, duration, mode, aspectRatio, size);

    const result = await fetch(TR_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${req.trKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await result.json();
    // Normalize: task_id bisa di top-level atau nested
    res.json({ task_id: data.task_id || data.data?.task_id, raw: data });

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
    const raw = await result.json();

    // Extract from nested formats
    const inner = raw.data || raw;
    const status = inner.status || raw.status || 'processing';
    const output = inner.result_url
      || inner.task_result?.videos?.[0]?.url
      || raw.result_url
      || null;
    const progress = inner.progress || null;

    res.json({
      status: (status === 'SUCCESS' || status === 'succeed') ? 'completed'
        : (status === 'FAILURE' || status === 'failed') ? 'failed'
        : 'processing',
      output,
      progress
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log('VideoAI running on http://localhost:'+PORT));
