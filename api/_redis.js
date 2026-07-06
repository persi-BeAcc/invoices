import { createClient } from 'redis';

// Shared Redis client, reused across warm serverless invocations.
// Files starting with "_" in /api are not exposed as endpoints by Vercel.
let client;

export async function getRedis() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('[redis] client error:', err.message));
  }
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}
