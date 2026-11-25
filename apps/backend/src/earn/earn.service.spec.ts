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
  TOKEN_PROGRAM_ID,
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
    return Promise.resolve((this.store.get(key) as T | undefined) ?? null);
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
      const mint = key.equals(
        associatedTokenAddress(addresses.vault, EARN_USDC, TOKEN_PROGRAM_ID),
      )
        ? EARN_USDC
        : new PublicKey(EARN_PROVIDERS.kamino.receipt);
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
  const chain = {
    lookupTables: jest.fn().mockResolvedValue([]),
    compile,
  } as unknown as Web3SwapChain;
  const durable = new Map<string, EarnPending>();
  const records: EarnRecords = {
    recover: jest.fn((userId: string, messageHash: string) => {
      const row = durable.get(messageHash);
      return Promise.resolve(row?.userId === userId ? row : null);
    }),
    pending: jest.fn((p: EarnPending) => {
      durable.set(p.messageHash, p);
      return Promise.resolve();
    }),
    reconcile: jest.fn().mockResolvedValue(undefined),
    earnings: jest
      .fn()
      .mockResolvedValue({ lifetimeMinor: '0', lastSevenDaysMinor: '0' }),
  };
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
    config,
    signTransaction,
    compile,
    durable,
    rpc,
  };
}
afterEach(() => jest.restoreAllMocks());
describe('Earn preparation and submission', () => {
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
