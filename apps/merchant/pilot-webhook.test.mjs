import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createPilotReceiver } from './pilot-webhook.mjs';

test('pilot verifies raw SDK signatures, rejects tampering and deduplicates signed event IDs', async (t) => {
  const secret = 'whsec_local-unit-test-only';
  const { server, events } = createPilotReceiver(secret);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/pilot/webhook`;
  const body = JSON.stringify({ id: 'evt_unit', type: 'payment.succeeded' });
  function headers(timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return { 'Xend-Signature': `t=${timestamp},v1=${signature}`, 'Xend-Event-Id': 'unsigned-do-not-trust' };
  }
  const send = (payload, signature = headers()) => fetch(url, { method: 'POST', headers: signature, body: payload });
  assert.equal((await send(body, {})).status, 400);
  assert.equal((await send(body + ' ')).status, 400);
  assert.equal((await send(body, headers(1))).status, 400);
  assert.equal(events.size, 0);
  assert.deepEqual(await (await send(body)).json(), { received: true, duplicate: false });
  assert.deepEqual(await (await send(body)).json(), { received: true, duplicate: true });
  assert.equal(events.size, 1);
  assert.ok(events.has('evt_unit'));
  assert.equal((await send('x'.repeat(65537))).status, 413);
});
