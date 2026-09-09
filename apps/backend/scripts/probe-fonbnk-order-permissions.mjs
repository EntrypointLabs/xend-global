/** Sandbox capability check using a non-issued order id. No user or order creation. */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const config = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
if (config.FONBNK_ENV !== 'sandbox' || !config.FONBNK_CLIENT_ID || !config.FONBNK_CLIENT_SECRET) {
  console.error('Sandbox Fonbnk credentials required; no request sent.'); process.exit(2);
}
// The all-zero object id is not an issued order. Confirmation cannot create an order.
const endpoint = '/api/v2/order/confirm';
const timestamp = String(Date.now());
const signature = createHmac('sha256', Buffer.from(config.FONBNK_CLIENT_SECRET, 'base64'))
  .update(`${timestamp}:${endpoint}`).digest('base64');
try {
  const response = await fetch('https://sandbox-api.fonbnk.com' + endpoint, {
    method: 'POST', body: JSON.stringify({ orderId: '000000000000000000000000' }), redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'x-client-id': config.FONBNK_CLIENT_ID,
      'x-timestamp': timestamp, 'x-signature': signature },
  });
  const body = await response.text();
  // Print only a fixed classification, never arbitrary provider messages or identities.
  const permissionDenied = response.status === 403 && body.includes('This feature is not available for this merchant');
  console.log(JSON.stringify({ environment: 'sandbox', endpoint, status: response.status,
    result: permissionDenied ? 'create_users_permission_required_contact_fonbnk_support'
      : response.status === 400 ? 'request_validation_reached_order_permission_not_proven'
      : 'unexpected_response_requires_review',
    timestamp: new Date().toISOString(), orderCreated: false }));
  if (response.ok) process.exitCode = 1;
} catch {
  console.error('Sandbox permission probe transport failure.'); process.exitCode = 1;
}
