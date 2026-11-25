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
  EARN_PROVIDERS,
  EARN_USDC,
  earnProviderAccounts,
  associatedTokenAddress,
  TOKEN_PROGRAM_ID,
  readEarnForwarderCode,
} from '@prydd/smart-account';
const args = process.argv.slice(2),
  arg = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const execute = args.includes('--execute');
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
const rpc = new Connection(rpcUrl, 'confirmed'),
  program = new PublicKey(programId);
const dummy = new PublicKey(new Uint8Array(32).fill(7));
const keys = new Map();
for (const provider of ['kamino', 'jupiter']) {
  const receipt = new PublicKey(EARN_PROVIDERS[provider].receipt);
  const dynamic = new Set([
    dummy.toBase58(),
    associatedTokenAddress(dummy, EARN_USDC, TOKEN_PROGRAM_ID).toBase58(),
    associatedTokenAddress(dummy, receipt, TOKEN_PROGRAM_ID).toBase58(),
  ]);
  for (const action of ['deposit', 'redeem'])
    for (const a of earnProviderAccounts(provider, action, dummy))
      if (!dynamic.has(a.pubkey.toBase58()))
        keys.set(a.pubkey.toBase58(), a.pubkey);
}
const addresses = [...keys.values()];
console.log(
  JSON.stringify(
    {
      mode: execute ? 'execute' : 'read-only plan',
      program: programId,
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
  const [create, address] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: await rpc.getSlot('finalized'),
  });
  await sendAndConfirmTransaction(rpc, new Transaction().add(create), [payer]);
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
