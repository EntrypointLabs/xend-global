// Planning is read-only. --execute is an explicit operator action after review.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  earnAsset,
  earnAssetsFor,
  earnProviderAccounts,
  associatedTokenAddress,
  readEarnForwarderCode,
} from '@prydd/smart-account';
const args = process.argv.slice(2),
  arg = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const execute = args.includes('--execute');
// Adds only the missing addresses to an existing table instead of creating one.
const extend = arg('--extend');
const binary = arg('--binary'),
  programId = process.env.EARN_FORWARDER_PROGRAM,
  rpcUrl = process.env.HELIUS_RPC_URL;
if (!binary || !programId || !rpcUrl)
  throw new Error(
    'Provide --binary, EARN_FORWARDER_PROGRAM and HELIUS_RPC_URL. No funds have moved.',
  );
const local = readFileSync(binary);
let end = local.length;
while (end > 0 && local[end - 1] === 0) end--;
const hash = createHash('sha256').update(local.subarray(0, end)).digest('hex');
const dummy = new PublicKey(new Uint8Array(32).fill(7));
const keys = new Map();
for (const provider of ['kamino', 'jupiter'])
  for (const asset of earnAssetsFor(provider)) {
    const { mint, receipt, tokenProgram } = earnAsset(provider, asset);
    const dynamic = new Set([
      dummy.toBase58(),
      associatedTokenAddress(dummy, mint, tokenProgram).toBase58(),
      associatedTokenAddress(dummy, receipt, tokenProgram).toBase58(),
    ]);
    for (const action of ['deposit', 'redeem'])
      for (const a of earnProviderAccounts(provider, action, dummy, asset))
        if (!dynamic.has(a.pubkey.toBase58()))
          keys.set(a.pubkey.toBase58(), a.pubkey);
  }
const rpc = new Connection(rpcUrl, 'confirmed'),
  program = new PublicKey(programId);
const existing = extend
  ? (await rpc.getAddressLookupTable(new PublicKey(extend))).value
  : null;
if (extend && !existing) throw new Error('No lookup table at --extend');
const present = new Set(
  (existing?.state.addresses ?? []).map((k) => k.toBase58()),
);
const addresses = [...keys.values()].filter((k) => !present.has(k.toBase58()));
if (present.size + addresses.length > 256)
  throw new Error('A lookup table holds at most 256 addresses');
console.log(
  JSON.stringify(
    {
      mode: execute ? 'execute' : 'read-only plan',
      program: programId,
      extending: extend ?? null,
      alreadyPresent: present.size,
      reviewedCodeSha256: hash,
      staticLookupAddresses: addresses.map((k) => k.toBase58()),
      lookupRentLamports: await rpc.getMinimumBalanceForRentExemption(
        56 + addresses.length * 32,
      ),
    },
    null,
    2,
  ),
);
if (execute) {
  const payerFile = arg('--payer-keypair');
  if (!payerFile)
    throw new Error('--execute requires an operator --payer-keypair file');
  const deployed = await readEarnForwarderCode(rpc, program);
  if (createHash('sha256').update(deployed).digest('hex') !== hash)
    throw new Error('Deployed code does not match the reviewed binary');
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(payerFile, 'utf8'))),
  );
  let address;
  if (existing) {
    if (!existing.state.authority?.equals(payer.publicKey))
      throw new Error('--payer-keypair is not the table authority');
    address = existing.key;
  } else {
    const [create, created] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: await rpc.getSlot('finalized'),
    });
    await sendAndConfirmTransaction(rpc, new Transaction().add(create), [
      payer,
    ]);
    address = created;
  }
  for (let i = 0; i < addresses.length; i += 20)
    await sendAndConfirmTransaction(
      rpc,
      new Transaction().add(
        AddressLookupTableProgram.extendLookupTable({
          lookupTable: address,
          authority: payer.publicKey,
          payer: payer.publicKey,
          addresses: addresses.slice(i, i + 20),
        }),
      ),
      [payer],
    );
  console.log(
    `EARN_FORWARDER_PROGRAM=${programId}\nEARN_LOOKUP_TABLE=${address.toBase58()}\nEARN_FORWARDER_CODE_SHA256=${hash}`,
  );
}
