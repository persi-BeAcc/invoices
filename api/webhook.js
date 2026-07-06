import { getRedis } from './_redis.js';

// Send a push notification via ntfy.sh — skipped if NTFY_TOPIC is not set
async function sendNtfy(title, message, tags = [], priority = '3') {
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
        'Priority': priority,
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
    const redis = await getRedis();
    if (type === 'email.delivered') {
      // Don't downgrade if already "opened" (events can arrive out of order)
      const existing = await redis.hGetAll(key);
      if (existing?.status === 'opened') {
        await redis.hSet(key, { deliveredAt: now });
      } else {
        await redis.hSet(key, { status: 'delivered', deliveredAt: now });
      }
      await sendNtfy('Invoice Delivered', `Invoice email delivered to ${data?.to || emailId}`, ['white_check_mark', 'envelope'], '3');
    } else if (type === 'email.opened') {
      // Always upgrade to "opened" — highest status
      await redis.hSet(key, { status: 'opened', openedAt: now });
      await sendNtfy('Invoice Opened', `Invoice email opened by ${data?.to || emailId}`, ['eyes'], '4');
    } else if (type === 'email.bounced' || type === 'email.complained') {
      await redis.hSet(key, { status: 'failed', failedAt: now });
    }
    // Other event types (email.sent, email.clicked) are silently accepted

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
