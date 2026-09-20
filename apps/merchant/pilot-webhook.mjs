import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { verifyWebhook } from '@xend/checkout-core/webhook';

// Local pilot only. No fulfilment side effects; secrets stay in this process.
export function createPilotReceiver(secret) {
  const events = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url !== '/pilot/webhook' || req.method !== 'POST') {
      res.writeHead(404).end('{}');
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) {
          res.writeHead(413).end('{}');
          return;
        }
        chunks.push(chunk);
      }
      const event = verifyWebhook(Buffer.concat(chunks), req.headers, secret);
      if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
        res.writeHead(400).end('{}');
        return;
      }
      const duplicate = events.has(event.id);
      if (!duplicate) {
        // Bound this in-memory test sink. Refuse rather than evict dedup keys.
        if (events.size >= 1000) {
          res.writeHead(503).end('{}');
          return;
        }
        events.set(event.id, event);
      }
      res.writeHead(200).end(JSON.stringify({ received: true, duplicate }));
      server.emit('verified-event', { event, duplicate });
    } catch {
      res.writeHead(400).end(JSON.stringify({ received: false }));
    }
  });
  return { server, events };
}

async function main() {
  const key = process.env.PILOT_DEVNET_API_KEY;
  if (!key) throw new Error('PILOT_DEVNET_API_KEY is required');
  const url = 'https://xend.global/pilot/webhook';
  async function api(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:8008/v1/webhook_endpoints${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Webhook endpoint API returned ${response.status}`);
    return response.json();
  }
  const existing = (await api('')).data.filter((endpoint) => endpoint.url === url);
  if (existing.length > 1) throw new Error('Multiple pilot endpoints exist; resolve them before proceeding');
  if (existing.length && !process.argv.includes('--rotate-local-secret')) {
    throw new Error('Pilot endpoint exists. Restart with --rotate-local-secret to explicitly rotate its signing secret');
  }
  const endpoint = existing.length
    ? await api(`/${existing[0].id}/rotate_secret`, 'POST')
    : await api('', 'POST', { url, event_types: ['payment.succeeded', 'payment.failed', 'payment.expired'] });
  if (typeof endpoint.secret !== 'string' || !endpoint.secret) throw new Error('Endpoint API did not return a signing secret');
  const { server } = createPilotReceiver(endpoint.secret);
  server.on('verified-event', ({ event, duplicate }) => {
    console.log(JSON.stringify({ verified: true, duplicate, event }));
  });
  server.listen(5175, '127.0.0.1', () => {
    console.log(JSON.stringify({ listening: '127.0.0.1:5175', endpointId: endpoint.id, url }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
