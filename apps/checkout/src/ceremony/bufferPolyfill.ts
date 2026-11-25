import { Buffer } from 'buffer';

// The Solana libraries the Spend decoder uses read Node's Buffer, which a
// browser lacks. Its own module so it runs before theirs.
globalThis.Buffer ??= Buffer;
