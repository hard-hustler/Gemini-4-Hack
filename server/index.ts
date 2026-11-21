// Small Node proxy for model calls. The key stays server-side in GEMINI_API_KEY.
import express from 'express';

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY) });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`api on http://localhost:${port}`));
