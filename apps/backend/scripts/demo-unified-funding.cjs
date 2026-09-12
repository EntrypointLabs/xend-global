/** Offline demo: executes the actual shared planner using labelled fixture quotes. */
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { planFunding, planSendAll, valueHoldings } = require('../src/fiat/funding/funding-planner');
const now = Date.now();
const expiresAt = new Date(now + 600000).toISOString();
const holdings = { NGN: { settledMinor: '50000000', reservedMinor: '0' }, USDC: { settledMinor: '100000000', reservedMinor: '0' } };
const ngnQuote = { reference: 'demo-offramp', sourceCurrency: 'USDC', destinationCurrency: 'NGN', sourceDebitMinor: '60000000', destinationCreditMinor: '10000000', expiresAt };
const usdcQuote = { reference: 'demo-onramp', sourceCurrency: 'NGN', destinationCurrency: 'USDC', sourceDebitMinor: '8333334', destinationCreditMinor: '50000000', expiresAt };
console.log(JSON.stringify({
  mode: 'OFFLINE SIMULATION — no real holdings or executable provider quotes',
  display: valueHoldings(holdings, 'USD', { ngnNumerator: '1', usdcDenominator: '6', asOf: new Date(now).toISOString(), expiresAt }, now),
  examples: [
    { label: 'Send NGN 400000', plan: planFunding(holdings, 'NGN', '40000000', '0', null, now) },
    { label: 'Send NGN 600000', plan: planFunding(holdings, 'NGN', '60000000', '0', ngnQuote, now) },
    { label: 'Send USDC 80', plan: planFunding(holdings, 'USDC', '80000000', '0', null, now) },
    { label: 'Send USDC 150', plan: planFunding(holdings, 'USDC', '150000000', '0', usdcQuote, now) },
    { label: 'Send all with USDC 1 payout fee', plan: planSendAll(holdings, 'USDC', '1000000', { ...usdcQuote, sourceDebitMinor: '50000000', destinationCreditMinor: '300000000' }, now) },
  ],
}, null, 2));
