import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  type AccountInfo,
} from '@solana/web3.js';
import { EarnService } from './earn.service';
import {
  associatedTokenAddress,
  EARN_USDC,
  EARN_PROVIDERS,
  JUPITER_EARN_ASSETS,
  TOKEN_PROGRAM_ID,
  earnAsset,
  earnAssetsFor,
  deriveAccountAddresses,
  readEarnExchangeRate,
  decodeAllowedPrograms,
} from '@prydd/smart-account';
import type { EarnRecords, EarnPending } from './earn-records';
import type { ApprovalSignerStore } from '../turnkey/approval-signer.store';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import type { SquadsAccountStore } from '../account/account.interface';
import type { SettlementAuthoritySigner } from '../settlement/settlement-authority.interface';
import type { Web3SwapChain } from '../swap/swap-chain.web3';
import { createHash } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
jest.mock('@jup-ag/lend/earn', () => ({
  getLendingTokenDetails: jest.fn().mockResolvedValue({ supplyRate: '400' }),
}));
jest.mock('@prydd/smart-account', () => {
  const actual = jest.requireActual<typeof import('@prydd/smart-account')>(
    '@prydd/smart-account',
  );
  return {
    ...actual,
    readEarnExchangeRate: jest.fn(),
    readEarnForwarderCode: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    decodeAllowedPrograms: jest.fn(() => actual.ABOVE_LIMIT_PROGRAM_ALLOWLIST),
  };
});
class MemoryPrepared implements PreparedTxStore {
  readonly store = new Map<string, unknown>();
  set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve(
      structuredClone((this.store.get(key) as T | undefined) ?? null),
    );
  }
  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}
function setup() {
  const primary = Keypair.generate(),
    approval = Keypair.generate(),
    sponsor = Keypair.generate(),
    program = Keypair.generate().publicKey,
    addresses = deriveAccountAddresses(42n);
  const config = new ConfigService({
    HELIUS_RPC_URL: 'http://rpc.test',
    SOLANA_CLUSTER: 'mainnet',
    EARN_DEPOSITS_KILLSWITCH: false,
    EARN_FORWARDER_PROGRAM: program.toBase58(),
    EARN_FORWARDER_CODE_SHA256: createHash('sha256')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex'),
    EARN_LOOKUP_TABLE: Keypair.generate().publicKey.toBase58(),
  });
  const prepared = new MemoryPrepared(),
    store = prepared.store;
  const row = {
    settingsSeed: 42n,
    primarySigner: primary.publicKey.toBase58(),
    approvalSigner: approval.publicKey.toBase58(),
  };
  const accounts = {
    findByUserId: jest.fn().mockResolvedValue(row),
  } as unknown as SquadsAccountStore;
  const broadcast = jest
    .fn<
      ReturnType<Connection['sendRawTransaction']>,
      Parameters<Connection['sendRawTransaction']>
    >()
    .mockResolvedValue('broadcast');
  // The vault's USDC and every receipt it could redeem, each in its own program.
  const vaultTokens = new Map(
    [
      { mint: EARN_USDC, program: TOKEN_PROGRAM_ID },
      ...(['kamino', 'jupiter'] as const).flatMap((provider) =>
        earnAssetsFor(provider).map((asset) => {
          const a = earnAsset(provider, asset);
          return { mint: a.receipt, program: a.tokenProgram };
        }),
      ),
    ]
      .filter(({ program }) => program.equals(TOKEN_PROGRAM_ID))
      .map(({ mint, program }) => [
        associatedTokenAddress(addresses.vault, mint, program).toBase58(),
        mint,
      ]),
  );
  // Other Earn token accounts the vault has never opened.
  const emptyEarnAccounts = new Set(
    (Object.keys(JUPITER_EARN_ASSETS) as (keyof typeof JUPITER_EARN_ASSETS)[])
      .map((asset) => earnAsset('jupiter', asset))
      .flatMap((a) => [
        associatedTokenAddress(addresses.vault, a.mint, a.tokenProgram),
        associatedTokenAddress(addresses.vault, a.receipt, a.tokenProgram),
      ])
      .map((k) => k.toBase58())
      .filter((k) => !vaultTokens.has(k)),
  );
  const getAccountInfo = jest.fn(
    (key: PublicKey): Promise<AccountInfo<Buffer> | null> => {
      if (key.equals(program))
        return Promise.resolve({
          executable: true,
          owner: PublicKey.default,
          lamports: 1,
          data: Buffer.alloc(0),
          rentEpoch: 0,
        });
      const mint = vaultTokens.get(key.toBase58());
      if (!mint)
        return Promise.resolve(
          emptyEarnAccounts.has(key.toBase58())
            ? null
            : {
                executable: false,
                owner: PublicKey.default,
                lamports: 1,
                data: Buffer.alloc(165),
                rentEpoch: 0,
              },
        );
      const data = Buffer.alloc(165);
      mint.toBuffer().copy(data);
      addresses.vault.toBuffer().copy(data, 32);
      data.writeBigUInt64LE(100_000_000n, 64);
      return Promise.resolve({
        executable: false,
        owner: TOKEN_PROGRAM_ID,
        lamports: 1,
        data,
        rentEpoch: 0,
      });
    },
  );
  const rpc = {
    sendRawTransaction: broadcast,
    getBlockHeight: jest.fn().mockResolvedValue(100),
    isBlockhashValid: jest
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: true }),
    getSignatureStatus: jest
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: null }),
    getAccountInfo,
    getTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
    getBalance: jest.fn().mockResolvedValue(3_000_000_000),
  };
  jest
    .mocked(readEarnExchangeRate)
    .mockResolvedValue({ numerator: 2n, denominator: 1n });
  const signTransaction = jest.fn((wire: string): Promise<string> => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
    tx.sign([sponsor]);
    return Promise.resolve(Buffer.from(tx.serialize()).toString('base64'));
  });
  const authority: SettlementAuthoritySigner = {
    address: sponsor.publicKey.toBase58(),
    signAndSend: jest.fn(),
    signTransaction,
  };
  const compile = jest.fn(
    (
      params: Parameters<Web3SwapChain['compile']>[0],
    ): ReturnType<Web3SwapChain['compile']> => {
      const instructions = params.instructions;
      const entries = [
        ...new Map(
          instructions
            .flatMap((ix) => ix.keys)
            .filter((k) => !k.isSigner)
            .map((k) => [k.pubkey.toBase58(), k.pubkey]),
        ).values(),
      ];
      const table = new AddressLookupTableAccount({
        key: Keypair.generate().publicKey,
        state: {
          addresses: entries,
          deactivationSlot: 0xffffffffffffffffn,
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
        },
      });
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: sponsor.publicKey,
          recentBlockhash: PublicKey.default.toBase58(),
          instructions,
        }).compileToV0Message([table]),
      );
      return Promise.resolve({
        unsignedTxBase64: Buffer.from(tx.serialize()).toString('base64'),
        messageBase64: Buffer.from(tx.message.serialize()).toString('base64'),
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 150,
      });
    },
  );
  const lookupTables = jest.fn().mockResolvedValue([]);
  const chain = {
    lookupTables,
    compile,
  } as unknown as Web3SwapChain;
  const durable = new Map<string, EarnPending>();
  const recordMocks = {
    recover: jest.fn((userId: string, messageHash: string) => {
      const row = durable.get(messageHash);
      return Promise.resolve(row?.userId === userId ? row : null);
    }),
    pending: jest.fn((p: EarnPending) => {
      durable.set(p.messageHash, p);
      return Promise.resolve();
    }),
    reconcile: jest.fn().mockResolvedValue(undefined),
    earnings: jest.fn(
      (_userId: string, positions: { provider: string; mint: string }[]) =>
        Promise.resolve(
          positions.map((p) => ({
            provider: p.provider as 'kamino' | 'jupiter',
            mint: p.mint,
            lifetimeMinor: '0' as string | null,
            lastSevenDaysMinor: '0' as string | null,
            netDepositedMinor: '0' as string | null,
          })),
        ),
    ),
    positionsWithHistory: jest.fn().mockResolvedValue(new Set<string>()),
    recordSnapshots: jest.fn().mockResolvedValue(undefined),
    snapshots: jest.fn().mockResolvedValue([]),
    usersWithEarn: jest.fn().mockResolvedValue([]),
  };
  const records: EarnRecords = recordMocks;
  const service = new EarnService(
    config,
    accounts,
    prepared,
    authority,
    chain,
    {
      findBySubOrganization: jest.fn().mockResolvedValue({ policyIds: null }),
    } as unknown as ApprovalSignerStore,
    records,
    {
      getUsdPrices: (mints: string[]) =>
        Promise.resolve(
          new Map(
            mints.map((m) => [
              m,
              {
                usdPrice: m === JUPITER_EARN_ASSETS.SOL.mint ? 150 : 1,
                priceChange24h: null,
                decimals: null,
              },
            ]),
          ),
        ),
    },
  );
  (service as unknown as { rpc: Connection }).rpc =
    rpc as unknown as Connection;
  return {
    service,
    primary,
    approval,
    sponsor,
    program,
    prepared,
    store,
    broadcast,
    authority,
    chain,
    lookupTables,
    config,
    signTransaction,
    compile,
    durable,
    rpc,
    records: recordMocks,
  };
}
afterEach(() => jest.restoreAllMocks());
describe('Earn preparation and submission', () => {
  it('trusts any listed forwarder build and refuses an unlisted one', async () => {
    const h = setup();
    const current = createHash('sha256')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex');
    const quote = () =>
      h.service.quote('a', {
        provider: 'kamino',
        action: 'deposit',
        amountMinor: '1000000',
      });
    h.config.set('EARN_FORWARDER_CODE_SHA256', `${'0'.repeat(64)},${current}`);
    await expect(quote()).resolves.toHaveProperty('quoteId');
    h.config.set('EARN_FORWARDER_CODE_SHA256', `${'0'.repeat(64)}`);
    await expect(quote()).rejects.toMatchObject({
      response: { code: 'EARN_UNAVAILABLE' },
    });
    h.config.set('EARN_FORWARDER_CODE_SHA256', current);
  });
  it('prices a deposit and bounds the receipt floor', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    expect(q.inputAmountRaw).toBe('1000000');
    expect(q.expectedOutRaw).toBe('500000');
    expect(q.minimumOutRaw).toBe('497500');
  });
  it('prices withdrawals in shares and refuses more than the owned position', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'redeem',
      amountMinor: '1000000',
    });
    expect(q.inputAmountRaw).toBe('500000');
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        action: 'redeem',
        amountMinor: '200000001',
      }),
    ).rejects.toThrow();
  });
  it('redeems all shares at the slider maximum despite a changed exchange value', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'redeem',
      amountMinor: '199999999',
      withdrawAll: true,
    });
    expect(q.inputAmountRaw).toBe('100000000');
    expect(q.expectedOutRaw).toBe('200000000');
  });
  it('refuses zero, negative, overflow and insufficient amounts', async () => {
    const h = setup();
    for (const amountMinor of ['0', '-1', '18446744073709551616', '100000001'])
      await expect(
        h.service.quote('a', {
          provider: 'kamino',
          action: 'deposit',
          amountMinor,
        }),
      ).rejects.toThrow();
  });
  it('pins quotes to their Consumer and refuses expired estimates', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    await expect(h.service.prepare('b', q.quoteId)).rejects.toThrow();
    const stored = h.store.get(`earn:quote:${q.quoteId}`) as {
      expiresAt: number;
    };
    stored.expiresAt = 0;
    await expect(h.service.prepare('a', q.quoteId)).rejects.toThrow();
  });
  it('keeps the existing Token constraint ordering and builds a forwarding plan', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    await h.service.prepare('a', q.quoteId);
    expect(decodeAllowedPrograms).toHaveBeenCalled();
    const ixs = h.compile.mock.calls[0][0].instructions;
    expect(ixs).toHaveLength(6);
    expect(ixs[4].programId.equals(h.program)).toBe(true);
  });
  it('rejects a transaction belonging to another Consumer and missing or forged signatures', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', q.quoteId);
    await expect(
      h.service.submit('b', prep.unsignedTxBase64),
    ).rejects.toThrow();
    await expect(
      h.service.submit('a', prep.unsignedTxBase64),
    ).rejects.toThrow();
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.signatures[1].fill(1);
    tx.signatures[2].fill(1);
    await expect(
      h.service.submit('a', Buffer.from(tx.serialize()).toString('base64')),
    ).rejects.toThrow();
    expect(h.broadcast).not.toHaveBeenCalled();
  });
  it('persists the fully signed wire before broadcast and reuses it after an ambiguous error', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', q.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    h.broadcast.mockRejectedValueOnce(new Error('network dropped'));
    await expect(h.service.submit('a', wire)).rejects.toThrow();
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
    const saved = [...h.store.values()].find(
      (v: unknown) => !!(v as { wire?: string }).wire,
    ) as { wire: string; signature: string };
    expect(saved.wire).toBeTruthy();
    expect(saved.signature).toBe(
      getBase58Decoder().decode(
        VersionedTransaction.deserialize(Buffer.from(saved.wire, 'base64'))
          .signatures[0],
      ),
    );
    await expect(h.service.submit('a', wire)).resolves.toEqual({
      signature: saved.signature,
    });
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
    expect(h.broadcast.mock.calls[0][0]).toEqual(h.broadcast.mock.calls[1][0]);
  });
  it('refuses expired unsigned approvals and disabled infrastructure', async () => {
    const h = setup();
    h.config.set('EARN_DEPOSITS_KILLSWITCH', true);
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toThrow();
    h.config.set('EARN_DEPOSITS_KILLSWITCH', false);
    h.config.set('EARN_FORWARDER_PROGRAM', '');
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toThrow();
  });
  it('keeps withdrawals available while deposits are paused', async () => {
    const h = setup();
    h.config.set('EARN_DEPOSITS_KILLSWITCH', true);
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        action: 'redeem',
        amountMinor: '1000000',
      }),
    ).resolves.toHaveProperty('action', 'redeem');
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toThrow();
  });
  it('recovers the identical broadcast from the durable ledger after the cache is lost', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    h.broadcast.mockRejectedValueOnce(new Error('network lost'));
    await expect(h.service.submit('a', wire)).rejects.toThrow();
    h.store.clear();
    await expect(h.service.submit('a', wire)).resolves.toHaveProperty(
      'signature',
    );
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
    expect(h.broadcast.mock.calls[0][0]).toEqual(h.broadcast.mock.calls[1][0]);
  });
  it('refuses an expired approval without sending or signing as sponsor', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    h.rpc.getBlockHeight.mockResolvedValue(200);
    await expect(
      h.service.submit('a', Buffer.from(tx.serialize()).toString('base64')),
    ).rejects.toThrow();
    expect(h.signTransaction).not.toHaveBeenCalled();
    expect(h.broadcast).not.toHaveBeenCalled();
  });
});

describe('Earn preparation expiry recovery', () => {
  it('recovers a concurrent sponsor after reading an unsigned pin near expiry', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    let concurrent: { signature: string } | undefined;
    h.rpc.getBlockHeight.mockImplementationOnce(async () => {
      concurrent = await h.service.submit('a', wire);
      return 200;
    });
    h.rpc.isBlockhashValid.mockResolvedValue({
      context: { slot: 1 },
      value: false,
    });
    const result = await h.service.submit('a', wire);
    expect(result).toEqual(concurrent);
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('returns a sponsored signature on expiry so a lost response does not bypass final status checks', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    const sent = await h.service.submit('a', wire);
    h.rpc.getBlockHeight.mockResolvedValue(200);
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_QUOTE_EXPIRED', signature: sent.signature },
    });
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
    expect(h.broadcast).toHaveBeenCalledTimes(1);
  });
  it('releases an expired never-broadcast approval after the preparation cache is lost', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    h.store.clear();
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_PREPARATION_UNAVAILABLE' },
    });
    h.rpc.isBlockhashValid
      .mockResolvedValueOnce({ context: { slot: 2 }, value: true })
      .mockResolvedValueOnce({ context: { slot: 1 }, value: false });
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_PREPARATION_UNAVAILABLE' },
    });
    h.rpc.isBlockhashValid.mockResolvedValue({
      context: { slot: 1 },
      value: false,
    });
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_QUOTE_EXPIRED' },
    });
    expect(h.rpc.isBlockhashValid).toHaveBeenLastCalledWith(
      tx.message.recentBlockhash,
      { commitment: 'finalized' },
    );
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it('checks durable broadcast status before treating a lost pin as expired', async () => {
    const h = setup();
    const quote = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', quote.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    const sent = await h.service.submit('a', wire);
    h.store.clear();
    h.rpc.isBlockhashValid.mockResolvedValue({
      context: { slot: 1 },
      value: false,
    });
    h.rpc.getSignatureStatus.mockResolvedValue({
      context: { slot: 1 },
      value: { confirmationStatus: 'confirmed' },
    });
    await expect(h.service.submit('a', wire)).resolves.toEqual(sent);
    expect(h.rpc.isBlockhashValid).not.toHaveBeenCalled();
    expect(h.broadcast).toHaveBeenCalledTimes(1);
  });
});

describe('Earn disabled environments and recovery', () => {
  it('serves disabled zero positions on devnet without querying pinned mainnet markets', async () => {
    const h = setup();
    h.config.set('SOLANA_CLUSTER', 'devnet');
    jest.mocked(readEarnExchangeRate).mockClear();
    const catalog = await h.service.catalog('a');
    expect(catalog.lifetimeMinor).toBe('0');
    expect(catalog.products).toHaveLength(2);
    expect(catalog.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kamino',
          apy: null,
          positionMinor: '0',
          available: false,
          withdrawAvailable: false,
        }),
        expect.objectContaining({
          id: 'jupiter',
          apy: null,
          positionMinor: '0',
          available: false,
          withdrawAvailable: false,
        }),
      ]),
    );
    expect(readEarnExchangeRate).not.toHaveBeenCalled();
    expect(h.rpc.getAccountInfo).not.toHaveBeenCalled();
    expect(h.lookupTables).not.toHaveBeenCalled();
  });
  it('reveals the saved sponsored signature during a deposit pause without rebroadcasting', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', q.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    h.broadcast.mockRejectedValueOnce(new Error('lost response'));
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_PENDING' },
    });
    const saved = [...h.durable.values()][0];
    h.config.set('EARN_DEPOSITS_KILLSWITCH', true);
    await expect(h.service.submit('a', wire)).resolves.toEqual({
      signature: saved.signature,
    });
    h.config.set('EARN_FORWARDER_PROGRAM', '');
    await expect(h.service.submit('a', wire)).resolves.toEqual({
      signature: saved.signature,
    });
    h.rpc.getBlockHeight.mockResolvedValue(200);
    await expect(h.service.submit('a', wire)).rejects.toMatchObject({
      response: { code: 'EARN_QUOTE_EXPIRED', signature: saved.signature },
    });
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('can expire an unsigned approval during a deposit pause without infrastructure', async () => {
    const h = setup();
    const q = await h.service.quote('a', {
      provider: 'kamino',
      action: 'deposit',
      amountMinor: '1000000',
    });
    const prep = await h.service.prepare('a', q.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    h.config.set('EARN_DEPOSITS_KILLSWITCH', true);
    h.config.set('EARN_FORWARDER_PROGRAM', '');
    h.rpc.getBlockHeight.mockResolvedValue(200);
    h.rpc.isBlockhashValid.mockResolvedValue({
      context: { slot: 1 },
      value: false,
    });
    await expect(
      h.service.submit('a', Buffer.from(tx.serialize()).toString('base64')),
    ).rejects.toMatchObject({ response: { code: 'EARN_QUOTE_EXPIRED' } });
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
});

const usdcReceipts = new Set<string>([
  EARN_PROVIDERS.kamino.receipt,
  JUPITER_EARN_ASSETS.USDC.receipt,
]);
describe('Earn valuation across vault-owned token accounts', () => {
  it('values non-associated receipts without offering them as canonical withdrawals', async () => {
    const h = setup();
    const owner = deriveAccountAddresses(42n).vault;
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
    h.rpc.getTokenAccountsByOwner.mockImplementation(
      (wallet: PublicKey, filter: { mint: PublicKey }) => {
        expect(wallet.equals(owner)).toBe(true);
        if (!usdcReceipts.has(filter.mint.toBase58()))
          return Promise.resolve({ value: [] });
        const entry = (amount: bigint, canonical: boolean) => {
          const data = Buffer.alloc(165);
          filter.mint.toBuffer().copy(data);
          owner.toBuffer().copy(data, 32);
          data.writeBigUInt64LE(amount, 64);
          return {
            pubkey: canonical
              ? associatedTokenAddress(owner, filter.mint, TOKEN_PROGRAM_ID)
              : Keypair.generate().publicKey,
            account: {
              owner: TOKEN_PROGRAM_ID,
              data,
              lamports: 1,
              executable: false,
              rentEpoch: 0,
            },
          };
        };
        return Promise.resolve({
          value: [entry(100_000_000n, true), entry(50_000_000n, false)],
        });
      },
    );
    const catalog = await h.service.catalog('a');
    for (const p of catalog.products) {
      expect(p.positionShares).toBe('150000000');
      expect(p.positionMinor).toBe('300000000');
      expect(p.withdrawableMinor).toBe('200000000');
    }
  });
  it('keeps an externally held position visible when the canonical account is empty', async () => {
    const h = setup();
    const owner = deriveAccountAddresses(42n).vault;
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
    h.rpc.getTokenAccountsByOwner.mockImplementation(
      (_wallet: PublicKey, filter: { mint: PublicKey }) => {
        if (!usdcReceipts.has(filter.mint.toBase58()))
          return Promise.resolve({ value: [] });
        const data = Buffer.alloc(165);
        filter.mint.toBuffer().copy(data);
        owner.toBuffer().copy(data, 32);
        data.writeBigUInt64LE(50_000_000n, 64);
        return Promise.resolve({
          value: [
            {
              pubkey: Keypair.generate().publicKey,
              account: {
                owner: TOKEN_PROGRAM_ID,
                data,
                lamports: 1,
                executable: false,
                rentEpoch: 0,
              },
            },
          ],
        });
      },
    );
    const catalog = await h.service.catalog('a');
    expect(
      catalog.products.every(
        (p) =>
          p.positionMinor === '100000000' &&
          p.withdrawableMinor === '0' &&
          !p.withdrawAvailable,
      ),
    ).toBe(true);
  });
});

describe('Canonical Earn cash limits', () => {
  it('returns the spendable ATA balance independently of arbitrary owner-account ordering', async () => {
    const h = setup();
    const owner = deriveAccountAddresses(42n).vault;
    const canonical = associatedTokenAddress(
      owner,
      EARN_USDC,
      TOKEN_PROGRAM_ID,
    );
    const original = h.rpc.getAccountInfo.getMockImplementation()!;
    h.rpc.getAccountInfo.mockImplementation((key: PublicKey) => {
      if (!key.equals(canonical)) return original(key);
      const data = Buffer.alloc(165);
      EARN_USDC.toBuffer().copy(data);
      owner.toBuffer().copy(data, 32);
      data.writeBigUInt64LE(10_006_000n, 64);
      return Promise.resolve({
        executable: false,
        owner: TOKEN_PROGRAM_ID,
        lamports: 1,
        data,
        rentEpoch: 0,
      });
    });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
    h.rpc.getTokenAccountsByOwner.mockResolvedValue({ value: [] });
    const catalog = await h.service.catalog('a');
    expect(catalog.depositableMinor).toBe('10006000');
    expect(h.rpc.getAccountInfo).toHaveBeenCalledWith(canonical);
    expect(
      h.rpc.getTokenAccountsByOwner.mock.calls.every(
        (call: unknown[]) =>
          !(call[1] as { mint: PublicKey }).mint.equals(EARN_USDC),
      ),
    ).toBe(true);
  });
});

describe('Earn position history', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const noFetch = () =>
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
  it('reports each position earnings beside the totals', async () => {
    const h = setup();
    noFetch();
    h.records.earnings.mockImplementation((_userId, positions) =>
      Promise.resolve(
        positions.map((p) => ({
          provider: p.provider as 'kamino' | 'jupiter',
          mint: p.mint,
          ...(p.provider === 'kamino'
            ? {
                lifetimeMinor: '250',
                lastSevenDaysMinor: null,
                netDepositedMinor: '1000',
              }
            : {
                lifetimeMinor: null,
                lastSevenDaysMinor: null,
                netDepositedMinor: null,
              }),
        })),
      ),
    );
    const catalog = await h.service.catalog('a');
    expect(catalog).not.toHaveProperty('providers');
    expect(catalog.lifetimeMinor).toBeNull();
    expect(catalog.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kamino',
          lifetimeMinor: '250',
          lastSevenDaysMinor: null,
        }),
        expect.objectContaining({
          id: 'jupiter',
          lifetimeMinor: null,
          lastSevenDaysMinor: null,
        }),
      ]),
    );
  });
  it('records the day snapshot after a catalog read and still answers when the write fails', async () => {
    const h = setup();
    noFetch();
    h.rpc.getTokenAccountsByOwner.mockResolvedValue({ value: [] });
    jest
      .mocked(h.records.positionsWithHistory)
      .mockResolvedValue(new Set([`jupiter:${EARN_USDC.toBase58()}`]));
    await h.service.catalog('a');
    await flush();
    expect(h.records.recordSnapshots).toHaveBeenCalledWith(
      'a',
      new Date().toISOString().slice(0, 10),
      [
        {
          provider: 'jupiter',
          mint: EARN_USDC.toBase58(),
          valueMinor: '0',
          netDepositedMinor: '0',
        },
      ],
    );
    jest
      .mocked(h.records.recordSnapshots)
      .mockRejectedValueOnce(new Error('database down'));
    await expect(h.service.catalog('a')).resolves.toHaveProperty('products');
    await flush();
  });
  it('snapshots nothing off mainnet', async () => {
    const h = setup();
    h.config.set('SOLANA_CLUSTER', 'devnet');
    await h.service.snapshot('a');
    await h.service.catalog('a');
    await flush();
    expect(h.records.reconcile).not.toHaveBeenCalled();
    expect(h.records.recordSnapshots).not.toHaveBeenCalled();
  });
  it('snapshots positions without the catalog rate lookups', async () => {
    const h = setup();
    const fetch = noFetch();
    await h.service.snapshot('a');
    expect(fetch).not.toHaveBeenCalled();
    expect(h.records.reconcile).toHaveBeenCalledWith('a', h.rpc);
    expect(h.records.recordSnapshots).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      [],
    );
  });
  it('returns history points ascending with earnings clamped at zero', async () => {
    const h = setup();
    h.records.snapshots.mockResolvedValue([
      {
        day: '2026-11-25',
        valueMinor: '15030000',
        netDepositedMinor: '15000000',
      },
      {
        day: '2026-11-24',
        valueMinor: '14999999',
        netDepositedMinor: '15000000',
      },
    ]);
    await expect(
      h.service.history('a', 'jupiter', 'all', EARN_USDC.toBase58()),
    ).resolves.toEqual({
      provider: 'jupiter',
      mint: EARN_USDC.toBase58(),
      points: [
        { day: '2026-11-24', valueMinor: '14999999', earnedMinor: '0' },
        { day: '2026-11-25', valueMinor: '15030000', earnedMinor: '30000' },
      ],
    });
    expect(h.records.snapshots).toHaveBeenCalledWith(
      'a',
      { provider: 'jupiter', mint: EARN_USDC.toBase58() },
      null,
    );
  });
});

describe('Earn beyond USDC', () => {
  it('combines every token into one dollar history when no mint is asked for', async () => {
    const h = setup();
    h.records.snapshots.mockImplementation(
      (_userId: string, key: { provider: string; mint: string }) =>
        Promise.resolve(
          key.mint === EARN_USDC.toBase58()
            ? [
                {
                  day: '2026-11-24',
                  valueMinor: '10000000',
                  netDepositedMinor: '10000000',
                },
                {
                  day: '2026-11-25',
                  valueMinor: '10010000',
                  netDepositedMinor: '10000000',
                },
              ]
            : key.mint === JUPITER_EARN_ASSETS.SOL.mint
              ? [
                  {
                    day: '2026-11-25',
                    valueMinor: '1001000000',
                    netDepositedMinor: '1000000000',
                  },
                ]
              : [],
        ),
    );
    await expect(h.service.history('a', 'jupiter', '30d')).resolves.toEqual({
      provider: 'jupiter',
      mint: null,
      points: [
        { day: '2026-11-24', valueMinor: '10000000', earnedMinor: '0' },
        // $10.01 of USDC plus 1.001 SOL at $150.
        { day: '2026-11-25', valueMinor: '160160000', earnedMinor: '160000' },
      ],
    });
    expect(h.records.snapshots).toHaveBeenCalledTimes(4);
  });
  it('refuses a combined history it cannot price in full', async () => {
    const h = setup();
    (
      h.service as unknown as {
        prices: { getUsdPrices: () => Promise<Map<string, unknown>> };
      }
    ).prices = { getUsdPrices: () => Promise.resolve(new Map()) };
    h.records.snapshots.mockImplementation(
      (_userId: string, key: { provider: string; mint: string }) =>
        Promise.resolve(
          key.mint === JUPITER_EARN_ASSETS.SOL.mint
            ? [
                {
                  day: '2026-11-25',
                  valueMinor: '1001000000',
                  netDepositedMinor: '1000000000',
                },
              ]
            : [],
        ),
    );
    await expect(
      h.service.history('a', 'jupiter', '30d'),
    ).rejects.toMatchObject({ response: { code: 'EARN_UNAVAILABLE' } });
  });

  // ConfigService.set also writes process.env, which outlives each setup().
  afterEach(() => delete process.env.EARN_ENABLED_ASSETS);
  const USDG = JUPITER_EARN_ASSETS.USDG.mint,
    SOL = JUPITER_EARN_ASSETS.SOL.mint;
  const noFetch = () =>
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
  it('refuses assets that are not enabled, and anything but USDC on Kamino', async () => {
    const h = setup();
    await expect(
      h.service.quote('a', {
        provider: 'jupiter',
        mint: USDG,
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toMatchObject({ response: { code: 'EARN_ASSET_UNAVAILABLE' } });
    h.config.set('EARN_ENABLED_ASSETS', 'USDC,USDT,USDG,SOL');
    await expect(
      h.service.quote('a', {
        provider: 'kamino',
        mint: USDG,
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toMatchObject({ response: { code: 'EARN_ASSET_UNAVAILABLE' } });
    await expect(
      h.service.quote('a', {
        provider: 'jupiter',
        mint: 'So11111111111111111111111111111111111111111',
        action: 'deposit',
        amountMinor: '1000000',
      }),
    ).rejects.toMatchObject({ response: { code: 'EARN_ASSET_UNAVAILABLE' } });
  });
  it('quotes and prepares a USDG deposit through Token-2022', async () => {
    const h = setup();
    h.config.set('EARN_ENABLED_ASSETS', 'USDC,USDG');
    const usdg = earnAsset('jupiter', 'USDG');
    const ata = associatedTokenAddress(
      deriveAccountAddresses(42n).vault,
      usdg.mint,
      usdg.tokenProgram,
    );
    const original = h.rpc.getAccountInfo.getMockImplementation()!;
    h.rpc.getAccountInfo.mockImplementation((key: PublicKey) => {
      if (!key.equals(ata)) return original(key);
      const data = Buffer.alloc(182);
      usdg.mint.toBuffer().copy(data);
      deriveAccountAddresses(42n).vault.toBuffer().copy(data, 32);
      data.writeBigUInt64LE(5_000_000n, 64);
      data[165] = 2;
      return Promise.resolve({
        executable: false,
        owner: usdg.tokenProgram,
        lamports: 1,
        data,
        rentEpoch: 0,
      });
    });
    await expect(
      h.service.quote('a', {
        provider: 'jupiter',
        mint: USDG,
        action: 'deposit',
        amountMinor: '6000000',
      }),
    ).rejects.toThrow('Amount exceeds your balance');
    const q = await h.service.quote('a', {
      provider: 'jupiter',
      mint: USDG,
      action: 'deposit',
      amountMinor: '5000000',
    });
    expect(q).toMatchObject({ mint: USDG, inputAmountRaw: '5000000' });
    const prep = await h.service.prepare('a', q.quoteId);
    expect(prep.quote.mint).toBe(USDG);
    const keys = h.compile.mock.calls[0][0].instructions.flatMap((ix) => [
      ix.programId,
      ...ix.keys.map((k) => k.pubkey),
    ]);
    expect(keys.some((k) => k.equals(usdg.tokenProgram))).toBe(true);
    expect(keys.some((k) => k.equals(usdg.receipt))).toBe(true);
    expect(keys.some((k) => k.equals(EARN_USDC))).toBe(false);
  });
  it('deposits native SOL up to the vault lamports and records the mint', async () => {
    const h = setup();
    h.config.set('EARN_ENABLED_ASSETS', 'USDC,SOL');
    await expect(
      h.service.quote('a', {
        provider: 'jupiter',
        mint: SOL,
        action: 'deposit',
        amountMinor: '3000000001',
      }),
    ).rejects.toThrow('Amount exceeds your balance');
    const q = await h.service.quote('a', {
      provider: 'jupiter',
      mint: SOL,
      action: 'deposit',
      amountMinor: '1000000000',
    });
    const prep = await h.service.prepare('a', q.quoteId);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prep.unsignedTxBase64, 'base64'),
    );
    tx.sign([h.primary, h.approval]);
    await h.service.submit('a', Buffer.from(tx.serialize()).toString('base64'));
    expect([...h.durable.values()][0]).toMatchObject({
      provider: 'jupiter',
      mint: SOL,
      action: 'deposit',
    });
  });
  it('repays the sponsor wrapped-SOL rent only when the vault has no wrapped-SOL account', async () => {
    const h = setup();
    h.config.set('EARN_ENABLED_ASSETS', 'USDC,SOL');
    const sol = earnAsset('jupiter', 'SOL');
    const wsol = associatedTokenAddress(
      deriveAccountAddresses(42n).vault,
      sol.mint,
      sol.tokenProgram,
    );
    const refunds = async () => {
      const q = await h.service.quote('a', {
        provider: 'jupiter',
        mint: SOL,
        action: 'deposit',
        amountMinor: '1000000000',
      });
      await h.service.prepare('a', q.quoteId);
      const ixs = h.compile.mock.calls.at(-1)![0].instructions;
      return ixs.some((ix) =>
        ix.keys.some(
          (k) =>
            k.pubkey.equals(new PublicKey(h.authority.address)) && !k.isSigner,
        ),
      );
    };
    expect(await refunds()).toBe(true);
    const original = h.rpc.getAccountInfo.getMockImplementation()!;
    h.rpc.getAccountInfo.mockImplementation((key: PublicKey) =>
      key.equals(wsol)
        ? Promise.resolve({
            executable: false,
            owner: TOKEN_PROGRAM_ID,
            lamports: 2_039_280,
            data: Buffer.alloc(165),
            rentEpoch: 0,
          })
        : original(key),
    );
    expect(await refunds()).toBe(false);
  });
  it('lists every Jupiter asset with its own figures and Kamino with USDC only', async () => {
    const h = setup();
    noFetch();
    h.config.set('EARN_ENABLED_ASSETS', 'USDC,SOL');
    const catalog = await h.service.catalog('a');
    const kamino = catalog.products.find((p) => p.id === 'kamino')!;
    const jupiter = catalog.products.find((p) => p.id === 'jupiter')!;
    expect(kamino.assets.map((a) => a.symbol)).toEqual(['USDC']);
    expect(jupiter.assets.map((a) => a.symbol)).toEqual([
      'USDC',
      'USDG',
      'SOL',
      'USDT',
    ]);
    const sol = jupiter.assets.find((a) => a.symbol === 'SOL')!;
    expect(jupiter.available).toBe(true);
    expect(sol).toMatchObject({
      mint: SOL,
      decimals: 9,
      positionRaw: '0',
      positionUsd: '0.000000',
      depositableRaw: '3000000000',
      lifetimeEarnedRaw: '0',
      lastSevenDaysEarnedRaw: '0',
      lifetimeEarnedUsd: '0.000000',
      lastSevenDaysEarnedUsd: '0.000000',
      available: true,
      withdrawAvailable: false,
    });
    expect(jupiter.assets.find((a) => a.symbol === 'USDG')!.available).toBe(
      false,
    );
    expect(jupiter.assets.find((a) => a.symbol === 'USDC')).toMatchObject({
      depositableRaw: '100000000',
      available: true,
    });
  });
  it('values a SOL position in its own row and keeps the USDC fields USDC', async () => {
    const h = setup();
    noFetch();
    const solReceipt = JUPITER_EARN_ASSETS.SOL.receipt;
    const owner = deriveAccountAddresses(42n).vault;
    h.rpc.getTokenAccountsByOwner.mockImplementation(
      (_wallet: PublicKey, filter: { mint: PublicKey }) => {
        if (filter.mint.toBase58() !== solReceipt)
          return Promise.resolve({ value: [] });
        const data = Buffer.alloc(165);
        filter.mint.toBuffer().copy(data);
        owner.toBuffer().copy(data, 32);
        data.writeBigUInt64LE(1_000_000_000n, 64);
        return Promise.resolve({
          value: [
            {
              pubkey: associatedTokenAddress(
                owner,
                filter.mint,
                TOKEN_PROGRAM_ID,
              ),
              account: {
                owner: TOKEN_PROGRAM_ID,
                data,
                lamports: 1,
                executable: false,
                rentEpoch: 0,
              },
            },
          ],
        });
      },
    );
    h.records.earnings.mockImplementation((_userId, positions) =>
      Promise.resolve(
        positions.map((p) => ({
          provider: p.provider as 'kamino' | 'jupiter',
          mint: p.mint,
          lifetimeMinor: p.mint === SOL ? '100000000' : '0',
          lastSevenDaysMinor: p.mint === SOL ? null : '0',
          netDepositedMinor: '0',
        })),
      ),
    );
    const catalog = await h.service.catalog('a');
    const jupiter = catalog.products.find((p) => p.id === 'jupiter')!;
    expect(jupiter.assets.find((a) => a.symbol === 'SOL')).toMatchObject({
      lifetimeEarnedRaw: '100000000',
      lifetimeEarnedUsd: '15.000000',
      lastSevenDaysEarnedUsd: null,
      positionRaw: '2000000000',
      positionUsd: '300.000000',
      withdrawableRaw: '2000000000',
      withdrawAvailable: false,
    });
    // The product-level fields stay USDC for app builds that read them as such.
    expect(jupiter.positionMinor).toBe('0');
    expect(jupiter.withdrawableMinor).toBe('0');
    expect(jupiter.withdrawAvailable).toBe(false);
    expect(jupiter.positionShares).toBe('0');
  });
});
