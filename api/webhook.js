import { createClient } from '@vercel/kv';

const kv = createClient({
  url: process.env.invoicesSimple_KV_REST_API_URL,
  token: process.env.invoicesSimple_KV_REST_API_TOKEN,
});

// Send a push notification via ntfy.sh — skipped if NTFY_TOPIC is not set
async function sendNtfy(title, message, tags = []) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.warn('[ntfy] NTFY_TOPIC not set — skipping notification');
    return;
  }
  console.log(`[ntfy] sending "${title}" to topic "${topic}"`);
  try {
    const ntfyRes = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Tags': tags.join(','),
        'Content-Type': 'text/plain',
      },
      body: message,
    });
    if (!ntfyRes.ok) {
      console.error(`[ntfy] non-OK response: ${ntfyRes.status} ${ntfyRes.statusText}`);
    } else {
      console.log(`[ntfy] delivered — status ${ntfyRes.status}`);
    }
  } catch (err) {
    console.error('[ntfy] fetch failed:', err.message);
  }
}

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
  const emailId = data?.email_id || data?.id;

  if (!emailId) return res.status(400).json({ error: 'Missing email_id in payload' });

  const now = new Date().toISOString();
  const key = `email:${emailId}`;

  try {
    if (type === 'email.delivered') {
      // Don't downgrade if already "opened" (events can arrive out of order)
      const existing = await kv.hgetall(key);
      if (existing?.status === 'opened') {
        await kv.hset(key, { deliveredAt: now });
      } else {
        await kv.hset(key, { status: 'delivered', deliveredAt: now });
      }
      await sendNtfy('Invoice email delivered', `Delivered to ${data?.to || emailId}`, ['email', 'white_check_mark']);
    } else if (type === 'email.opened') {
      // Always upgrade to "opened" — highest status
      await kv.hset(key, { status: 'opened', openedAt: now });
      await sendNtfy('Invoice email opened', `Opened by ${data?.to || emailId}`, ['eyes', 'envelope']);
    } else if (type === 'email.bounced' || type === 'email.complained') {
      await kv.hset(key, { status: 'failed', failedAt: now });
    }
    // Other event types (email.sent, email.clicked) are silently accepted

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
