/** Read-only official sandbox probe. Never creates accounts or moves money. */
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});
const { randomUUID } = require('node:crypto');
const { PagaProvider, PagaError } = require('../src/fiat/banking/paga.provider.ts');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('From the repository root:\n  node --env-file=apps/backend/.env apps/backend/scripts/probe-paga-adapter.cjs [--account=OWNED_SANDBOX_ACCOUNT_REFERENCE]');
    return;
  }
  if (args.length > 1 || args.some((arg) => !/^--account=[A-Za-z0-9_-]{1,50}$/.test(arg)))
    throw new Error('INVALID_ARGUMENTS');
  const keys = ['PAGA_SANDBOX_PUBLIC_KEY', 'PAGA_SANDBOX_SECRET_KEY', 'PAGA_SANDBOX_HASH_KEY'];
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    console.log(JSON.stringify({ environment: 'sandbox', missing }));
    process.exitCode = 1;
    return;
  }
  const requests = [];
  const provider = new PagaProvider({
    environment: 'sandbox',
    publicKey: process.env[keys[0]],
    secretKey: process.env[keys[1]],
    hashKey: process.env[keys[2]],
  }, async (url, init) => {
    const parsed = new URL(url);
    if (!['https://beta-collect.paga.com', 'https://beta.mypaga.com'].includes(parsed.origin))
      throw new Error('SANDBOX_ONLY');
    // Explicit read-operation allowlist: no future adapter change can turn this into a payment probe.
    const bankList = parsed.pathname === '/paga-webservices/business-rest/secured/getBanks';
    const accountRead = /^\/subsidiary-accounts\/[A-Za-z0-9_-]+(?:\/balance)?$/.test(parsed.pathname);
    if (!(bankList && init.method === 'POST') && !(accountRead && init.method === 'GET'))
      throw new Error('READ_ONLY');
    const response = await fetch(url, init);
    // Do not record request headers, bodies, account identifiers, response bodies or error messages.
    requests.push({ api: bankList ? 'business' : 'collect', httpStatus: response.status });
    return response;
  });
  const observations = [];
  async function probe(operation, call, summarize) {
    try {
      const result = await call();
      observations.push({ operation, acceptedByAdapter: true, ...summarize(result) });
      return true;
    } catch (error) {
      observations.push({ operation, acceptedByAdapter: false, code: error instanceof PagaError ? error.code : 'PROBE_FAILED' });
      return false;
    }
  }
  const banksAccepted = await probe('listBanks', () => provider.banks(), (banks) => ({ count: banks.length }));
  const accountIdentifier = args[0]?.slice('--account='.length);
  let accountAccepted = false;
  if (accountIdentifier) {
    accountAccepted = await probe('retrieveOwnedAccount', () => provider.retrieveAccount(accountIdentifier, randomUUID()), () => ({ currency: 'NGN' }));
    if (accountAccepted)
      accountAccepted = await probe('readOwnedBalance', () => provider.getBalance(accountIdentifier, randomUUID()), (balance) => ({ currency: balance.currency, observedAt: balance.observedAt }));
  } else {
    // A negative read exposes rejected authentication without making a customer account.
    // A rejection is never treated as proof that product access works.
    await probe('nonexistentAccountControl', () => provider.retrieveAccount(`xprobe${randomUUID().replaceAll('-', '').slice(0, 20)}`, randomUUID()), () => ({ unexpectedAccount: true }));
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), environment: 'sandbox', readOnly: true,
    observations, requests,
    verified: { bankListing: banksAccepted, ownedAccountAndBalance: accountAccepted, accountCreation: false, transfers: false, conversion: false },
  }, null, 2));
  if (!banksAccepted || (accountIdentifier && !accountAccepted) || observations.some((o) => o.code === 'AUTHENTICATION' || o.unexpectedAccount))
    process.exitCode = 1;
}
main().catch(() => { console.error('Paga sandbox probe failed; no raw provider payload logged.'); process.exitCode = 1; });
