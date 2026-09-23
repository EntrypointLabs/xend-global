/** Read-only authenticated sandbox controls. Never credits a balance or sends a payout.
 * From repo root: node --env-file=apps/backend/.env apps/backend/scripts/probe-nomba-authenticated.cjs --local-account
 */
require('reflect-metadata');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
require('ts-node').register({
  project: resolve(__dirname, '../tsconfig.json'),
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    resolvePackageJsonExports: false,
  },
});
const { NombaSandboxAuth } = require('../src/fiat/banking/nomba-auth');
const { NombaAdapter } = require('../src/fiat/banking/nomba.adapter');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('SANDBOX_ONLY');
  if (process.argv.slice(2).some((arg) => arg !== '--local-account'))
    throw new Error('UNSUPPORTED_ARGUMENT');
  const accountId = process.env.NOMBA_SANDBOX_ACCOUNT_ID;
  const auth = new NombaSandboxAuth({
    accountId,
    clientId: process.env.NOMBA_SANDBOX_CLIENT_ID,
    clientSecret: process.env.NOMBA_SANDBOX_CLIENT_SECRET,
  });
  const adapter = new NombaAdapter({
    accountId,
    senderName: 'Xend Sandbox',
    accessToken: () => auth.getAccessToken(),
  });
  const observations = [];
  const read = async (path) => {
    const token = await auth.getAccessToken();
    const response = await fetch(`https://sandbox.nomba.com${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, accountId },
    });
    return { response, payload: await response.json() };
  };
  await auth.getAccessToken();
  observations.push({ name: 'authentication', accepted: true });
  observations.push({
    name: 'bank directory',
    count: (await adapter.banks()).length,
  });
  if (process.argv.includes('--local-account')) {
    // The dev endpoint derives its one fixed identity; callers cannot select another user.
    const response = await fetch(
      'http://localhost:8008/dev/fiat/banking/accounts',
      {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'x-xend-local-simulation': '1' },
      },
    );
    if (!response.ok) throw new Error('LOCAL_ACCOUNTS_UNAVAILABLE');
    const payload = await response.json();
    const saved = payload.accounts?.find(
      (row) =>
        row.provider === 'nomba' &&
        row.environment === 'sandbox' &&
        row.status === 'active',
    );
    if (!saved?.account) throw new Error('LOCAL_NOMBA_ACCOUNT_UNAVAILABLE');
    const recovered = await adapter.retrieveAccount(
      saved.account.reference,
      saved.id,
    );
    const matches = Object.keys(recovered).every(
      (key) => recovered[key] === saved.account[key],
    );
    observations.push({ name: 'persisted account recovery', matches });
    if (!matches) throw new Error('PERSISTED_ACCOUNT_MISMATCH');
  }
  const neverCreatedAccount = `xend-control-${randomUUID()}`;
  const accountControl = await read(
    `/v1/accounts/virtual/${encodeURIComponent(neverCreatedAccount)}`,
  );
  observations.push({
    name: 'never-created account',
    http: accountControl.response.status,
    code: accountControl.payload.code,
  });
  const neverCreatedTransaction = `xend-control-${randomUUID()}`;
  const transactionControl = await read(
    `/v1/transactions/accounts/single?transactionRef=${encodeURIComponent(neverCreatedTransaction)}`,
  );
  observations.push({
    name: 'never-submitted transaction',
    http: transactionControl.response.status,
    code: transactionControl.payload.code,
    status: transactionControl.payload.data?.status,
    echoesNeverSubmittedId:
      transactionControl.payload.data?.id === neverCreatedTransaction,
  });
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        environment: 'sandbox',
        settlementVerified: false,
        observations,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  // Never dump provider payloads, token response bodies, credentials or customer coordinates.
  const code =
    typeof error.code === 'string' &&
    /^(NOMBA|LOCAL|PERSISTED)_/.test(error.code)
      ? error.code
      : 'PROBE_FAILED';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
