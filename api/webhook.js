import { kv } from '@vercel/kv';

// CORS helper
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Resend sends webhook events as JSON with { type, data }
  // See: https://resend.com/docs/dashboard/webhooks/event-types
  const { type, data } = req.body || {};
  const emailId = data?.email_id;

  if (!emailId) return res.status(400).json({ error: 'Missing email_id in payload' });

  const now = new Date().toISOString();
  const key = `email:${emailId}`;

  try {
    if (type === 'email.delivered') {
      await kv.hset(key, { status: 'delivered', deliveredAt: now });
    } else if (type === 'email.opened') {
      // Only upgrade status — don't overwrite "opened" back to "delivered"
      await kv.hset(key, { status: 'opened', openedAt: now });
    } else if (type === 'email.bounced' || type === 'email.complained') {
      await kv.hset(key, { status: 'failed', failedAt: now });
    }
    // Other event types (email.sent, email.clicked) are silently accepted

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
