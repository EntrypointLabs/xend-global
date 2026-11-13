/** Sandbox discovery/quote probe only. Never creates users, orders or transfers. */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const local = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
const config = { ...local, ...process.env };
const clientId = config.FONBNK_CLIENT_ID;
const secret = config.FONBNK_CLIENT_SECRET;
if (config.FONBNK_ENV !== 'sandbox') {
  console.error('Set FONBNK_ENV=sandbox. This probe cannot use production.');
  process.exit(2);
}
if (!clientId || !secret) {
  console.error('Missing FONBNK_CLIENT_ID or FONBNK_CLIENT_SECRET. No requests sent.');
  process.exit(2);
}

const host = 'https://sandbox-api.fonbnk.com';
function emit(label, data) {
  // Never emit credentials, request headers, full responses or customer data.
  console.log(JSON.stringify({ label, ...data }));
}
async function request(path, body) {
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${timestamp}:${path}`).digest('base64');
  const response = await fetch(host + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-client-id': clientId, 'x-timestamp': timestamp,
      'x-signature': signature, 'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Status alone avoids reflecting secrets or arbitrary server content.
    throw new Error(`Provider HTTP ${response.status} for ${path.split('?')[0]}`);
  }
  return data;
}

const fiat = { paymentChannel: 'bank', currencyType: 'fiat', currencyCode: 'NGN', countryIsoCode: 'NG' };
const crypto = { paymentChannel: 'crypto', currencyType: 'crypto', currencyCode: 'SOLANA_USDC' };
const routes = [
  { name: 'NGN_TO_SOLANA_USDC', deposit: fiat, payout: crypto, amount: 10000 },
  { name: 'SOLANA_USDC_TO_NGN', deposit: crypto, payout: fiat, amount: 10 },
];

function limitsPath(route) {
  const query = new URLSearchParams();
  for (const side of ['deposit', 'payout']) {
    for (const [key, value] of Object.entries(route[side])) {
      query.set(side + key[0].toUpperCase() + key.slice(1), value);
    }
  }
  return `/api/v2/order-limits?${query}`;
}
function legSummary(leg) {
  return {
    currencyCode: leg?.currencyCode,
    currencyDetails: leg?.currencyDetails && {
      network: leg.currencyDetails.network, asset: leg.currencyDetails.asset,
      contractAddress: leg.currencyDetails.contractAddress,
      countryIsoCode: leg.currencyDetails.countryIsoCode,
    },
    transferType: leg?.transferType,
    amountBeforeFees: leg?.cashout?.amountBeforeFees,
    amountAfterFees: leg?.cashout?.amountAfterFees,
    totalChargedFees: leg?.cashout?.totalChargedFees,
    fields: leg?.fieldsToCreateOrder?.map(f => ({
      key: f.key, type: f.type, required: f.required,
    })),
  };
}

try {
  emit('probe', { environment: 'sandbox', timestamp: new Date().toISOString(), simulated: true });
  const currencies = await request('/api/v2/currencies');
  if (!Array.isArray(currencies)) throw new Error('Unexpected currency response shape');
  const relevant = currencies.filter(c => ['NGN', 'SOLANA_USDC'].includes(c.currencyCode));
  emit('currencies', { currencies: relevant.map(c => ({
    currencyCode: c.currencyCode, currencyType: c.currencyType,
    country: c.currencyDetails?.countryIsoCode, mint: c.currencyDetails?.contractAddress,
    channels: c.paymentChannels?.map(p => ({ type: p.type,
      isDepositAllowed: p.isDepositAllowed, isPayoutAllowed: p.isPayoutAllowed,
      transferTypes: p.transferTypes })),
  })) });
  for (const route of routes) {
    try {
      const limits = await request(limitsPath(route));
      emit(route.name + '_limits', { deposit: limits?.deposit, payout: limits?.payout });
      const { min, max, step } = limits?.deposit ?? {};
      if (![min, max, step].every(Number.isFinite) || min <= 0 || max < min || step <= 0) {
        emit(route.name, { result: 'unavailable_or_invalid_limits' });
        process.exitCode = 1;
        continue;
      }
      // Diagnostic amounts only; never used for a real Spend or fiat debit.
      const amount = Math.round(Math.ceil(Math.max(min, Math.min(route.amount, max)) / step) * step * 1e6) / 1e6;
      if (amount > max || amount < min) throw new Error('No valid diagnostic amount within limits');
      const quote = await request('/api/v2/quote', {
        deposit: { ...route.deposit, amount }, payout: route.payout,
      });
      if (!quote?.quoteId || !quote?.quoteExpiresAt ||
          quote.deposit?.currencyCode !== route.deposit.currencyCode ||
          quote.payout?.currencyCode !== route.payout.currencyCode) {
        throw new Error('Unexpected quote shape or pair mismatch');
      }
      emit(route.name + '_quote', {
        quoteId: quote.quoteId, expiresAt: quote.quoteExpiresAt,
        deposit: legSummary(quote.deposit), payout: legSummary(quote.payout),
        result: 'sandbox_quote_only_not_order_or_payment_proof',
      });
    } catch (error) {
      emit(route.name, { error: error.message });
      process.exitCode = 1;
    }
  }
} catch (error) {
  emit('probe_failed', { error: error.message });
  process.exitCode = 1;
}
