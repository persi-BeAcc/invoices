import { createClient } from '@vercel/kv';

const kv = createClient({
  url: process.env.invoicesSimple_KV_REST_API_URL,
  token: process.env.invoicesSimple_KV_REST_API_TOKEN,
});

// CORS helper
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing ?id= parameter' });

  try {
    const record = await kv.hgetall(`email:${id}`);

    if (!record) return res.status(200).json({ status: null });

    return res.status(200).json({
      status: record.status || null,
      deliveredAt: record.deliveredAt || null,
      openedAt: record.openedAt || null,
      failedAt: record.failedAt || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
