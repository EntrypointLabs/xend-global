/** Credential-free probes only. No environment/secret loading. No production writes.
 * Run: node apps/backend/scripts/probe-public-fiat.mjs
 * Nomba sandbox writes are simulated; a SUCCESS response is not settlement proof.
 */
import { randomUUID } from 'node:crypto';
const nomba = 'https://sandbox.nomba.com';
const ref = `xend_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const observations = [];
async function probe(label, url, body) {
  if (body && new URL(url).origin !== nomba) throw new Error('Writes restricted to Nomba sandbox');
  const row = { label, method: body ? 'POST' : 'GET', url };
  try {
    const response = await fetch(url, {
      method: row.method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    row.httpStatus = response.status;
    const payload = await response.json();
    const data = payload.data;
    // Deliberately omit provider sample identities, BVNs, emails and bank details.
    row.result = {
      code: payload.code ?? payload.statusCode ?? payload.error?.code,
      message: payload.message ?? payload.description ?? payload.statusMessage ?? payload.error?.message,
      errors: payload.errors,
      recordCount: Array.isArray(data) ? data.length : undefined,
      id: data?.id, status: data?.status, type: data?.type,
      reference: data?.merchantTxRef ?? data?.meta?.merchantTxRef ?? data?.accountRef,
    };
    observations.push(row);
    return payload;
  } catch (error) {
    row.error = error.message;
    observations.push(row);
    return null;
  }
}
await Promise.all([
  probe('Paga sandbox banks auth gate', 'https://beta-collect.paga.com/banks'),
  probe('Flutterwave sandbox banks auth gate', 'https://developersandbox-api.flutterwave.com/banks?country=NG'),
  probe('Paystack public bank directory (read-only)', 'https://api.paystack.co/bank?country=nigeria'),
  probe('Paystack dedicated accounts auth gate (read-only)', 'https://api.paystack.co/dedicated_account'),
]);
const account = await probe('Nomba static receiving details', `${nomba}/v1/accounts/virtual`, {
  accountRef: ref, accountName: 'Xend Sandbox Test', currency: 'NGN',
});
if (account?.data?.bankAccountNumber) {
  const read = await probe('Nomba account read-back', `${nomba}/v1/accounts/virtual/${encodeURIComponent(account.data.bankAccountNumber)}`);
  observations.at(-1).matchesCreatedAccount = read?.data?.bankAccountNumber === account.data.bankAccountNumber;
}
const transfer = {
  amount: 3500, accountNumber: '0000000000', accountName: 'Xend Sandbox Test',
  bankCode: '058', merchantTxRef: ref, senderName: 'Test Sender', narration: 'Sandbox test',
};
await probe('Nomba invalid account length', `${nomba}/v2/transfers/bank`, { ...transfer, accountNumber: '000000000' });
const first = await probe('Nomba transfer', `${nomba}/v2/transfers/bank`, transfer);
const retry = await probe('Nomba same-reference retry', `${nomba}/v2/transfers/bank`, transfer);
observations.at(-1).sameTransactionId = Boolean(first?.data?.id && first.data.id === retry?.data?.id);
if (first?.data?.id) {
  await probe('Nomba transfer requery', `${nomba}/v1/transactions/accounts/single?transactionRef=${encodeURIComponent(first.data.id)}`);
}
await probe('Nomba nonexistent-reference control', `${nomba}/v1/transactions/accounts/single?transactionRef=${ref}_never_created`);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), warning: 'Sandbox responses do not prove real settlement, KYC approval, custody or idempotency.', observations }, null, 2));
