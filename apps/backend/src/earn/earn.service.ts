import { parseKaminoRate, parseJupiterRate } from './earn-rate';
import { EARN_RECORDS, type EarnRecords } from './earn-records';
import {
  historyPoints,
  positionKey,
  rangeStartDay,
  snapshotsToRecord,
  totalEarnings,
  utcDay,
  type EarnHistoryRange,
  type EarnPositionKey,
  type ProviderEarnings,
} from './earn-history';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import {
  associatedTokenAddress,
  buildEarnInstructions,
  decodeAllowedPrograms,
  deriveAccountAddresses,
  derivePolicyAddress,
  EARN_PROVIDERS,
  EARN_USDC,
  earnAsset,
  earnAssetByMint,
  earnAssetsFor,
  readEarnExchangeRate,
  readEarnForwarderCode,
  sharesForValue,
  sharesValue,
  depositShares,
  type EarnAssetId,
  type EarnProviderId,
  type EarnAction,
  type EarnExchangeRate,
} from '@prydd/smart-account';
import {
  TOKEN_PRICE_PROVIDER,
  type TokenPriceProvider,
} from '../prices/token-price.interface';
import {
  TOKEN_METADATA_PROVIDER,
  type TokenMetadataProvider,
} from '../tokens/token-metadata.interface';
import {
  SQUADS_ACCOUNT_STORE,
  ABOVE_LIMIT_POLICY_SEED,
  type SquadsAccountStore,
} from '../account/account.interface';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
  type PreparedTxStore,
} from '../prepared/prepared-tx.interface';
import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import {
  APPROVAL_SIGNER_STORE,
  type ApprovalSignerStore,
} from '../turnkey/approval-signer.store';
import { Web3SwapChain } from '../swap/swap-chain.web3';

export interface EarnRequest {
  provider: EarnProviderId;
  /** The lent asset; USDC when absent. `amountMinor` is in its base units. */
  mint?: string;
  action: EarnAction;
  amountMinor: string;
  withdrawAll?: boolean;
}
export interface EarnQuote extends Omit<EarnRequest, 'withdrawAll' | 'mint'> {
  mint: string;
  quoteId: string;
  inputAmountRaw: string;
  expectedOutRaw: string;
  minimumOutRaw: string;
  expiresAt: number;
}
interface StoredQuote extends EarnQuote {
  userId: string;
}
interface Pin {
  userId: string;
  quote: EarnQuote;
  blockHeight: number;
  signature?: string;
  wire?: string;
}
const USDC = EARN_USDC.toBase58();
/** Quotes and ledger rows written before Earn knew more than one asset are USDC. */
const quoteAsset = (quote: { mint?: string }): EarnAssetId =>
  earnAssetByMint(quote.mint ?? USDC) ?? 'USDC';
type Position = EarnPositionKey & {
  asset: EarnAssetId;
  price: EarnExchangeRate;
  holdings: { total: bigint; withdrawable: bigint };
  shares: bigint;
  value: bigint;
};
/** A raw amount in USD micro-units (USDC minor units), or null if unpriced. */
function usdMicro(
  raw: bigint,
  decimals: number,
  usdPrice: number | undefined,
): bigint | null {
  if (usdPrice === undefined || !Number.isFinite(usdPrice) || usdPrice < 0)
    return null;
  return (
    (raw * BigInt(Math.round(usdPrice * 1e9))) / 10n ** BigInt(decimals + 3)
  );
}
const fail = () =>
  new ServiceUnavailableException({
    code: 'EARN_UNAVAILABLE',
    message: 'Earn is unavailable right now',
  });
@Injectable()
export class EarnService {
  private readonly logger = new Logger(EarnService.name);
  private rpc: Connection;
  constructor(
    private readonly config: ConfigService,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly accounts: SquadsAccountStore,
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
    private readonly chain: Web3SwapChain,
    @Inject(APPROVAL_SIGNER_STORE)
    private readonly approvals: ApprovalSignerStore,
    @Inject(EARN_RECORDS) private readonly records: EarnRecords,
    @Optional()
    @Inject(TOKEN_PRICE_PROVIDER)
    private readonly prices?: TokenPriceProvider,
    @Optional()
    @Inject(TOKEN_METADATA_PROVIDER)
    private readonly metadata?: TokenMetadataProvider,
  ) {
    this.rpc = new Connection(
      config.getOrThrow<string>('HELIUS_RPC_URL'),
      'confirmed',
    );
  }
  private program(): PublicKey {
    const id = this.config.get<string>('EARN_FORWARDER_PROGRAM');
    if (!id) throw fail();
    return new PublicKey(id);
  }
  private async infrastructure(action: EarnAction | 'read' = 'read') {
    if (
      this.config.get<string>('SOLANA_CLUSTER') !== 'mainnet' ||
      (action === 'deposit' &&
        this.config.get<boolean>('EARN_DEPOSITS_KILLSWITCH'))
    )
      throw fail();
    const program = this.program(),
      lookup = this.config.get<string>('EARN_LOOKUP_TABLE');
    if (!lookup) throw fail();
    const [info, tables] = await Promise.all([
      this.rpc.getAccountInfo(program),
      this.chain.lookupTables([lookup]),
    ]);
    if (!info?.executable) throw fail();
    const expectedHash = this.config.get<string>('EARN_FORWARDER_CODE_SHA256');
    if (!expectedHash) throw fail();
    const code = await readEarnForwarderCode(this.rpc, program);
    if (createHash('sha256').update(code).digest('hex') !== expectedHash)
      throw fail();
    return { program, tables };
  }
  private async account(userId: string) {
    const row = await this.accounts.findByUserId(userId);
    if (!row) throw new ConflictException('Your Account is not ready');
    const addresses = deriveAccountAddresses(row.settingsSeed);
    const enrolled = this.approvals
      ? await this.approvals.findBySubOrganization(row.approvalSubOrgId)
      : null;
    return {
      approvalCompatible: !!enrolled && !enrolled.policyIds?.length,
      addresses,
      policy: derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
      signers: [
        new PublicKey(row.primarySigner),
        new PublicKey(row.approvalSigner),
      ],
    };
  }
  /**
   * Assets enabled for new moves. Others still show any position the vault
   * holds; they wait on a forwarder that can carry them.
   */
  private enabled(asset: EarnAssetId): boolean {
    const list = (this.config.get<string>('EARN_ENABLED_ASSETS') ?? 'USDC')
      .split(',')
      .map((a) => a.trim().toUpperCase());
    return list.includes(asset);
  }
  private isTokenAccount(
    data: Buffer,
    program: PublicKey,
    accountProgram: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
  ) {
    return (
      accountProgram.equals(program) &&
      data.length >= 165 &&
      new PublicKey(data.subarray(0, 32)).equals(mint) &&
      new PublicKey(data.subarray(32, 64)).equals(owner)
    );
  }
  /** What the vault can lend of an asset: native lamports for SOL. */
  private async balance(owner: PublicKey, asset: EarnAssetId): Promise<bigint> {
    const { mint, tokenProgram } = earnAsset('jupiter', asset);
    if (asset === 'SOL') return BigInt(await this.rpc.getBalance(owner));
    return this.tokenBalance(owner, mint, tokenProgram);
  }
  /** The owner's canonical associated account for a mint, which Earn moves from. */
  private async tokenBalance(
    owner: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
  ): Promise<bigint> {
    const info = await this.rpc.getAccountInfo(
      associatedTokenAddress(owner, mint, tokenProgram),
    );
    if (!info) return 0n;
    if (!this.isTokenAccount(info.data, tokenProgram, info.owner, mint, owner))
      throw fail();
    return info.data.readBigUInt64LE(64);
  }
  private async receiptBalances(
    owner: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
  ) {
    const response = await this.rpc.getTokenAccountsByOwner(
      owner,
      { mint },
      'confirmed',
    );
    const canonical = associatedTokenAddress(owner, mint, tokenProgram);
    let total = 0n,
      withdrawable = 0n;
    for (const { pubkey, account } of response.value) {
      if (
        !this.isTokenAccount(
          account.data,
          tokenProgram,
          account.owner,
          mint,
          owner,
        )
      )
        throw fail();
      const amount = account.data.readBigUInt64LE(64);
      total += amount;
      if (pubkey.equals(canonical)) withdrawable += amount;
    }
    return { total, withdrawable };
  }
  private mainnet() {
    return this.config.get<string>('SOLANA_CLUSTER') === 'mainnet';
  }
  private async position(
    vault: PublicKey,
    provider: EarnProviderId,
    asset: EarnAssetId,
  ): Promise<Position> {
    const a = earnAsset(provider, asset);
    const [price, holdings] = await Promise.all([
      readEarnExchangeRate(this.rpc, provider, asset),
      this.receiptBalances(vault, a.receipt, a.tokenProgram),
    ]);
    return {
      provider,
      mint: a.mint.toBase58(),
      asset,
      price,
      holdings,
      shares: holdings.total,
      value: sharesValue(holdings.total, price),
    };
  }
  private async positions(vault: PublicKey): Promise<Position[]> {
    const keys = (Object.keys(EARN_PROVIDERS) as EarnProviderId[]).flatMap(
      (provider) =>
        earnAssetsFor(provider).map((asset) => ({ provider, asset })),
    );
    return Promise.all(
      keys.map(({ provider, asset }) => this.position(vault, provider, asset)),
    );
  }
  private async recordSnapshots(
    userId: string,
    positions: Position[],
    earnings: (EarnPositionKey & ProviderEarnings)[],
  ) {
    const withHistory = await this.records.positionsWithHistory(userId);
    const byKey = new Map(earnings.map((e) => [positionKey(e), e]));
    await this.records.recordSnapshots(
      userId,
      utcDay(new Date()),
      snapshotsToRecord(
        positions.flatMap((p) => {
          const e = byKey.get(positionKey(p));
          return e ? [{ ...p, earnings: e }] : [];
        }),
        withHistory,
      ),
    );
  }
  async snapshot(userId: string): Promise<void> {
    if (!this.mainnet()) return;
    const a = await this.account(userId);
    await this.records.reconcile(userId, this.rpc);
    const positions = await this.positions(a.addresses.vault);
    const earnings = await this.records.earnings(userId, positions);
    await this.recordSnapshots(userId, positions, earnings);
  }
  async history(
    userId: string,
    provider: EarnProviderId,
    range: EarnHistoryRange,
    mint: string = USDC,
  ) {
    const asset = earnAssetByMint(mint);
    if (!asset || !earnAssetsFor(provider).includes(asset))
      throw new BadRequestException('Unsupported Earn asset');
    const rows = await this.records.snapshots(
      userId,
      { provider, mint },
      rangeStartDay(range, new Date()),
    );
    return { provider, mint, points: historyPoints(rows) };
  }
  private async apy(provider: EarnProviderId, asset: EarnAssetId) {
    let apy: number | null = null;
    // Rate failure never fabricates a zero and does not erase a real position.
    try {
      if (provider === 'jupiter') {
        const sdk = await import('@jup-ag/lend/earn');
        const details = await sdk.getLendingTokenDetails({
          connection: this.rpc,
          lendingToken: earnAsset(provider, asset).receipt,
          market: 'main',
        });
        const supplyRate: unknown = details.supplyRate;
        apy = parseJupiterRate(supplyRate);
      } else {
        const response = await fetch(
          'https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics',
          { signal: AbortSignal.timeout(5000) },
        );
        if (response.ok)
          apy = parseKaminoRate((await response.json()) as unknown);
      }
    } catch {
      /* Position and withdrawal reads remain available without an APY. */
    }
    if (apy !== null && (!Number.isFinite(apy) || apy < 0 || apy > 10))
      return null;
    return apy;
  }
  async catalog(userId: string) {
    // These deployments exist only on mainnet. No mainnet address is a
    // valuation source for a devnet Account, even when the wallet read works.
    if (!this.mainnet())
      return {
        products: (Object.keys(EARN_PROVIDERS) as EarnProviderId[]).map(
          (id) => ({
            id,
            provider: EARN_PROVIDERS[id].name,
            name: 'Lending Yield',
            apy: null,
            positionShares: '0',
            positionMinor: '0',
            withdrawableMinor: '0',
            available: false,
            withdrawAvailable: false,
            lifetimeMinor: '0',
            lastSevenDaysMinor: '0',
            updatedAt: new Date().toISOString(),
            assets: [],
          }),
        ),
        lifetimeMinor: '0',
        lastSevenDaysMinor: '0',
        depositableMinor: '0',
      };
    const a = await this.account(userId);
    const ready =
      a.approvalCompatible &&
      (await this.infrastructure().then(
        () => true,
        () => false,
      ));
    await this.records.reconcile(userId, this.rpc);
    const positions = await this.positions(a.addresses.vault);
    const assets = [...new Set(positions.map((p) => p.asset))];
    const mints = assets.map((asset) =>
      earnAsset('jupiter', asset).mint.toBase58(),
    );
    const [earnings, apys, depositable, prices, metadata] = await Promise.all([
      this.records.earnings(userId, positions),
      Promise.all(positions.map((p) => this.apy(p.provider, p.asset))),
      Promise.all(
        assets.map((asset) => this.balance(a.addresses.vault, asset)),
      ),
      this.prices
        ? this.prices.getUsdPrices(mints).catch(() => new Map())
        : Promise.resolve(new Map()),
      this.metadata
        ? this.metadata.getMetadata(mints).catch(() => new Map())
        : Promise.resolve(new Map()),
    ]);
    // The chart is a side effect of this read and must never delay or fail it.
    void this.recordSnapshots(userId, positions, earnings).catch(
      (err: unknown) => this.logger.warn('earn.snapshot_failed', err),
    );
    const depositableOf = new Map(
      assets.map((asset, i) => [asset, depositable[i]]),
    );
    const earningsOf = new Map(earnings.map((e) => [positionKey(e), e]));
    const depositsOpen =
      ready && !this.config.get<boolean>('EARN_DEPOSITS_KILLSWITCH');
    const rows = positions.map((p, i) => {
      const asset = earnAsset(p.provider, p.asset);
      // Earn's USDC figures have always been dollars at face value.
      const usdPrice =
        p.mint === USDC
          ? 1
          : (prices as Map<string, { usdPrice: number }>).get(p.mint)?.usdPrice;
      const usd = (raw: bigint) =>
        raw === 0n ? 0n : usdMicro(raw, asset.decimals, usdPrice);
      const e = earningsOf.get(positionKey(p));
      const withdrawable = sharesValue(p.holdings.withdrawable, p.price);
      const enabled = this.enabled(p.asset);
      return {
        provider: p.provider,
        value: p.value,
        withdrawable,
        lifetime: e?.lifetimeMinor ?? null,
        lastSevenDays: e?.lastSevenDaysMinor ?? null,
        apy: apys[i],
        shares: p.shares,
        asset: {
          mint: p.mint,
          symbol: asset.symbol,
          name:
            (metadata as Map<string, { name: string }>).get(p.mint)?.name ??
            asset.name,
          iconUrl:
            (metadata as Map<string, { iconUrl: string | null }>).get(p.mint)
              ?.iconUrl ?? null,
          decimals: asset.decimals,
          apy: apys[i],
          positionRaw: p.value.toString(),
          positionUsd: formatUsd(usd(p.value)),
          withdrawableRaw: withdrawable.toString(),
          lifetimeEarnedRaw: e?.lifetimeMinor ?? null,
          lastSevenDaysEarnedRaw: e?.lastSevenDaysMinor ?? null,
          depositableRaw: (depositableOf.get(p.asset) ?? 0n).toString(),
          available: depositsOpen && enabled,
          withdrawAvailable: ready && enabled && p.holdings.withdrawable > 0n,
        },
      };
    });
    // The product-level fields stay USDC, exactly as before other assets
    // existed: app builds that predate `assets` read them as the USDC position
    // they can withdraw, and would offer a USDC redemption against SOL shares.
    const products = (Object.keys(EARN_PROVIDERS) as EarnProviderId[]).map(
      (id) => {
        const mine = rows.filter((r) => r.provider === id);
        const usdc = mine.find((r) => r.asset.mint === USDC)!;
        return {
          id,
          provider: EARN_PROVIDERS[id].name,
          name: 'Lending Yield',
          apy: usdc.apy,
          positionShares: usdc.shares.toString(),
          positionMinor: usdc.value.toString(),
          withdrawableMinor: usdc.withdrawable.toString(),
          available: usdc.asset.available,
          withdrawAvailable: usdc.asset.withdrawAvailable,
          lifetimeMinor: usdc.lifetime,
          lastSevenDaysMinor: usdc.lastSevenDays,
          updatedAt: new Date().toISOString(),
          assets: mine.map((r) => r.asset),
        };
      },
    );
    const totals = totalEarnings(products);
    return {
      products,
      lifetimeMinor: totals.lifetimeMinor,
      lastSevenDaysMinor: totals.lastSevenDaysMinor,
      depositableMinor: (depositableOf.get('USDC') ?? 0n).toString(),
    };
  }
  async quote(userId: string, dto: EarnRequest): Promise<EarnQuote> {
    await this.infrastructure(dto.action);
    const a = await this.account(userId);
    const asset = earnAssetByMint(dto.mint ?? USDC);
    if (
      !asset ||
      !earnAssetsFor(dto.provider).includes(asset) ||
      !this.enabled(asset)
    )
      throw new BadRequestException({
        code: 'EARN_ASSET_UNAVAILABLE',
        message: 'Earn is not available for this token yet',
      });
    const { receipt, mint } = earnAsset(dto.provider, asset);
    if (!a.approvalCompatible)
      throw new ConflictException({
        code: 'EARN_APPROVAL_POLICY_REVIEW_REQUIRED',
        message:
          'This Account needs a signer permission review before using Earn',
      });
    if (dto.withdrawAll && dto.action !== 'redeem')
      throw new BadRequestException('Invalid withdrawal');
    const amount = BigInt(dto.amountMinor);
    if (amount <= 0n || amount >= 0xffffffffffffffffn)
      throw new BadRequestException('Choose a valid amount');
    const [price, balance] = await Promise.all([
      readEarnExchangeRate(this.rpc, dto.provider, asset),
      dto.action === 'deposit'
        ? this.balance(a.addresses.vault, asset)
        : this.tokenBalance(
            a.addresses.vault,
            receipt,
            earnAsset(dto.provider, asset).tokenProgram,
          ),
    ]);
    let input = amount;
    if (dto.action === 'redeem') {
      const value = sharesValue(balance, price);
      if (!dto.withdrawAll && amount > value)
        throw new BadRequestException('Amount exceeds your position');
      input =
        dto.withdrawAll || amount === value
          ? balance
          : sharesForValue(amount, price);
    }
    if (input > balance)
      throw new BadRequestException('Amount exceeds your balance');
    const expected =
        dto.action === 'deposit'
          ? depositShares(input, price)
          : sharesValue(input, price),
      minimum = (expected * 9950n) / 10000n;
    if (minimum <= 0n) throw new BadRequestException('Amount is too small');
    const quote: EarnQuote = {
      provider: dto.provider,
      mint: mint.toBase58(),
      action: dto.action,
      amountMinor: dto.amountMinor,
      quoteId: randomUUID(),
      inputAmountRaw: input.toString(),
      expectedOutRaw: expected.toString(),
      minimumOutRaw: minimum.toString(),
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    };
    await this.prepared.set<StoredQuote>(
      `earn:quote:${quote.quoteId}`,
      { ...quote, userId },
      120,
    );
    return quote;
  }
  async prepare(userId: string, quoteId: string) {
    const stored = await this.prepared.get<StoredQuote>(
      `earn:quote:${quoteId}`,
    );
    if (
      !stored ||
      stored.userId !== userId ||
      stored.expiresAt <= Math.floor(Date.now() / 1000)
    )
      throw new ConflictException({
        code: 'EARN_QUOTE_EXPIRED',
        message: 'The estimate expired. Try again.',
      });
    const infrastructure = await this.infrastructure(stored.action);
    const a = await this.account(userId);
    if (!a.approvalCompatible) throw fail();
    const info = await this.rpc.getAccountInfo(a.policy);
    if (!info) throw fail();
    const allowed = decodeAllowedPrograms(a.policy, info);
    const asset = quoteAsset(stored);
    if (!this.enabled(asset)) throw fail();
    // The sponsor is repaid wrapped-SOL rent only for an account it opens.
    const wrappedSolAccountExists =
      asset === 'SOL' &&
      !!(await this.rpc.getAccountInfo(
        associatedTokenAddress(
          a.addresses.vault,
          earnAsset('jupiter', 'SOL').mint,
          earnAsset('jupiter', 'SOL').tokenProgram,
        ),
      ));
    const instructions = buildEarnInstructions({
      ...a,
      provider: stored.provider,
      asset,
      wrappedSolAccountExists,
      action: stored.action,
      amount: BigInt(stored.inputAmountRaw),
      minimumOut: BigInt(stored.minimumOutRaw),
      allowedPrograms: allowed,
      feePayer: new PublicKey(this.authority.address),
      forwarderProgram: infrastructure.program,
    });
    const compiled = await this.chain.compile({
      instructions,
      lookupTables: infrastructure.tables,
    });
    const quote: EarnQuote = {
      provider: stored.provider,
      mint: earnAsset(stored.provider, asset).mint.toBase58(),
      action: stored.action,
      amountMinor: stored.amountMinor,
      quoteId: stored.quoteId,
      inputAmountRaw: stored.inputAmountRaw,
      expectedOutRaw: stored.expectedOutRaw,
      minimumOutRaw: stored.minimumOutRaw,
      expiresAt: stored.expiresAt,
    };
    await this.prepared.set<Pin>(
      pinKey(compiled.messageBase64),
      { userId, quote, blockHeight: compiled.lastValidBlockHeight },
      PREPARED_TX_TTL_SECONDS,
    );
    return {
      ...compiled,
      quote,
      settingsAddress: a.addresses.settings.toBase58(),
      forwarderProgram: infrastructure.program.toBase58(),
    };
  }
  private async recoverUnsignedExpiry(
    userId: string,
    key: string,
    tx: VersionedTransaction,
  ): Promise<{ signature: string }> {
    const validity = await Promise.all(
      (['confirmed', 'finalized'] as const).map((commitment) =>
        this.rpc.isBlockhashValid(tx.message.recentBlockhash, { commitment }),
      ),
    );
    // A request may have read an unsigned pin while another request sponsors
    // and broadcasts it. Re-read AFTER finalized expiry: any transaction that
    // could already have landed must have been durably recorded before send.
    // A sponsor still in flight cannot newly land once this hash has expired.
    const recovered = await this.records.recover(userId, key);
    const latest = await this.prepared.get<Pin>(key);
    const signature =
      recovered?.signature ??
      (latest?.userId === userId ? latest.signature : undefined);
    if (signature) return { signature };
    if (validity.every((result) => !result.value))
      throw new ConflictException({
        code: 'EARN_QUOTE_EXPIRED',
        message:
          'The approval expired. Check your balance before trying again.',
      });
    throw new ConflictException({
      code: 'EARN_PREPARATION_UNAVAILABLE',
      message: 'Your approval is still being checked. Try again shortly.',
    });
  }

  async submit(userId: string, signedTxBase64: string) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(
        Buffer.from(signedTxBase64, 'base64'),
      );
    } catch {
      throw new BadRequestException('Invalid Earn transaction');
    }
    const key = pinKey(Buffer.from(tx.message.serialize()).toString('base64'));
    let pin = await this.prepared.get<Pin>(key);
    if (!pin) {
      const recovered = await this.records.recover(userId, key);
      if (recovered?.status === 'confirmed')
        return { signature: recovered.signature };
      if (recovered)
        pin = {
          userId,
          wire: recovered.wire ?? undefined,
          signature: recovered.signature,
          quote: recovered.quote as unknown as EarnQuote,
          blockHeight: recovered.blockHeight,
        };
    }
    if (!pin) {
      return this.recoverUnsignedExpiry(userId, key, tx);
    }
    if (pin.userId !== userId)
      throw new BadRequestException('Earn transaction does not match');
    if (pin.signature) {
      const status = await this.rpc.getSignatureStatus(pin.signature, {
        searchTransactionHistory: true,
      });
      if (status.value) return { signature: pin.signature };
    }
    if ((await this.rpc.getBlockHeight('confirmed')) > pin.blockHeight) {
      if (!pin.signature) return this.recoverUnsignedExpiry(userId, key, tx);
      throw new ConflictException({
        code: 'EARN_QUOTE_EXPIRED',
        // A lost submission response may have kept this signature off the phone.
        // Return it so the phone checks historical status and finalized expiry.
        ...(pin.signature ? { signature: pin.signature } : {}),
        message:
          'The approval expired. Check your balance before trying again.',
      });
    }
    try {
      await this.infrastructure(pin.quote.action);
    } catch (error) {
      // Recovery is a read, not another deposit. A pause or deployment outage
      // must not hide an already sponsored signature from its Account.
      if (pin.signature) return { signature: pin.signature };
      throw error;
    }
    if (tx.signatures.slice(1).some((s) => s.every((b) => b === 0)))
      throw new BadRequestException('Both Account signatures are required');
    if (tx.message.header.numRequiredSignatures !== 3)
      throw new BadRequestException('Unexpected Earn signers');
    const message = tx.message.serialize();
    for (let i = 1; i < 3; i++) {
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          tx.message.staticAccountKeys[i].toBuffer(),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (!verify(null, message, publicKey, tx.signatures[i]))
        throw new BadRequestException('Invalid Account signature');
    }
    if (!pin.wire) {
      if (!this.authority.signTransaction) throw fail();
      pin.wire = await this.authority.signTransaction(signedTxBase64);
      const sponsored = VersionedTransaction.deserialize(
        Buffer.from(pin.wire, 'base64'),
      );
      pin.signature = getBase58Decoder().decode(sponsored.signatures[0]);
      // Save BEFORE broadcast; concurrent retries sign the same immutable message
      // and therefore have the same network signature, never a second deposit.
      await this.prepared.set(key, pin, 60 * 60 * 24 * 30);
    }
    const account = await this.account(userId);
    await this.records.pending({
      userId,
      signature: pin.signature!,
      wire: pin.wire,
      vault: account.addresses.vault.toBase58(),
      provider: pin.quote.provider,
      mint: pin.quote.mint ?? USDC,
      action: pin.quote.action,
      messageHash: key,
      quote: { ...pin.quote },
      blockHeight: pin.blockHeight,
    });
    try {
      await this.rpc.sendRawTransaction(Buffer.from(pin.wire, 'base64'), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'EARN_PENDING',
        message:
          'Your approval is saved. Check its status before trying another amount.',
        signature: pin.signature,
      });
    }
    return { signature: pin.signature! };
  }
}
function formatUsd(micro: bigint | null): string | null {
  if (micro === null) return null;
  const whole = micro / 1_000_000n,
    fraction = (micro % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}
function pinKey(message: string): string {
  return `earn:prepared:${createHash('sha256').update(message).digest('hex')}`;
}
