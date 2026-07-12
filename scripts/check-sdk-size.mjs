#!/usr/bin/env node
// Zero-dependency CI size gate for the checkout-core IIFE. Gzips the
// script-tag bundle and fails if it exceeds the budget. The IIFE is the
// script-tag distribution surface, so its transfer size is the number
// that matters to merchants.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BUDGET_BYTES = 15 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const artifact = join(
  here,
  '..',
  'packages',
  'checkout-core',
  'dist',
  'xend-checkout.iife.js',
);

let raw;
try {
  raw = readFileSync(artifact);
} catch {
  console.error(
    `sdk.size status=fail reason=missing_artifact path=${artifact}\n` +
      'Build @xend/checkout-core first (npm run build).',
  );
  process.exit(1);
}

const gzBytes = gzipSync(raw).length;
const status = gzBytes <= BUDGET_BYTES ? 'pass' : 'fail';
console.log(
  `sdk.size iife_gz_bytes=${gzBytes} budget_bytes=${BUDGET_BYTES} status=${status}`,
);
process.exit(status === 'pass' ? 0 : 1);
