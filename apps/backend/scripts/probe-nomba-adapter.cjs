/** Credentialless sandbox contract probe. Never proves settlement; no raw identities logged. */
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const { randomUUID } = require('node:crypto');
const { NombaAdapter } = require('../src/fiat/banking/nomba.adapter.ts');
const observations = [];
let observedReference;
// Capture opaque transaction ID only for the dependent requery; do not print provider identities.
const transport = async (url, init) => {
  const response = await fetch(url, init);
  if (url.endsWith('/v2/transfers/bank')) {
    const payload = await response.clone().json();
    if (typeof payload.data?.id === 'string') observedReference = payload.data.id;
  }
  return response;
};
const adapter = new NombaAdapter({ senderName: 'Xend Sandbox Test' }, transport);
const reference = `xend_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
async function probe(name, operation) {
  try {
    const result = await operation();
    observations.push({ name, acceptedByAdapter: true, evidence: result.evidence ?? 'fixture', status: result.status, currency: result.currency });
    return result;
  } catch (error) {
    observations.push({ name, acceptedByAdapter: false, code: typeof error.code === 'string' ? error.code : 'PROBE_FAILED' });
  }
}
(async () => {
  await probe('createAccount', () => adapter.createAccount({ reference, accountReference: reference, firstName: 'Xend', lastName: 'Sandbox', email: 'sandbox@example.com' }));
  const payout = { reference, amountMinor: '350000', recipient: { bankCode: '058', accountNumber: '0000000000', accountName: 'Xend Sandbox Test' }, narration: 'Sandbox contract probe' };
  await probe('submitPayout', () => adapter.submitPayout(payout));
  if (observedReference) await probe('getPayout', () => adapter.getPayout({ ...payout, providerReference: observedReference }));
  else observations.push({ name: 'getPayout', skipped: 'No provider reference returned' });
  await probe('getPayout nonexistent control', () => adapter.getPayout({ ...payout, providerReference: `${reference}_nonexistent` }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'public sandbox fixture', observations }, null, 2));
})().catch(() => { console.error('Probe failed'); process.exitCode = 1; });
