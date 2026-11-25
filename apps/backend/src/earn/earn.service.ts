import { parseKaminoRate, parseJupiterRate } from './earn-rate';
import { EARN_RECORDS, type EarnRecords } from './earn-records';
import {
  Inject,
  Injectable,
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
  readEarnExchangeRate,
  readEarnForwarderCode,
  sharesForValue,
  sharesValue,
  depositShares,
  TOKEN_PROGRAM_ID,
  type EarnProviderId,
  type EarnAction,
} from '@prydd/smart-account';
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
  action: EarnAction;
  amountMinor: string;
  withdrawAll?: boolean;
}
export interface EarnQuote extends Omit<EarnRequest, 'withdrawAll'> {
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
const fail = () =>
  new ServiceUnavailableException({
    code: 'EARN_UNAVAILABLE',
    message: 'Earn is unavailable right now',
  });
@Injectable()
export class EarnService {
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
  private async balance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    const info = await this.rpc.getAccountInfo(
      associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID),
    );
    if (!info) return 0n;
    if (
      !info.owner.equals(TOKEN_PROGRAM_ID) ||
      info.data.length !== 165 ||
      !new PublicKey(info.data.subarray(0, 32)).equals(mint) ||
      !new PublicKey(info.data.subarray(32, 64)).equals(owner)
    )
      throw fail();
    return info.data.readBigUInt64LE(64);
  }
  async catalog(userId: string) {
    const a = await this.account(userId);
    const ready =
      a.approvalCompatible &&
      (await this.infrastructure().then(
        () => true,
        () => false,
      ));
    await this.records.reconcile(userId, this.rpc);
    const positions = {} as Record<
      EarnProviderId,
      { shares: bigint; value: bigint }
    >;
    const products = await Promise.all(
      (Object.keys(EARN_PROVIDERS) as EarnProviderId[]).map(
        async (provider) => {
          const p = EARN_PROVIDERS[provider];
          const [price, shares] = await Promise.all([
            readEarnExchangeRate(this.rpc, provider),
            this.balance(a.addresses.vault, new PublicKey(p.receipt)),
          ]);
          positions[provider] = { shares, value: sharesValue(shares, price) };
          let apy: number | null = null;
          // Rate failure never fabricates a zero and does not erase a real position.
          try {
            if (provider === 'jupiter') {
              const sdk = await import('@jup-ag/lend/earn');
              const details = await sdk.getLendingTokenDetails({
                connection: this.rpc,
                lendingToken: new PublicKey(p.receipt),
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
            apy = null;
          return {
            id: provider,
            provider: p.name,
            name: 'Lending Yield',
            apy,
            positionShares: shares.toString(),
            positionMinor: sharesValue(shares, price).toString(),
            available:
              ready && !this.config.get<boolean>('EARN_DEPOSITS_KILLSWITCH'),
            withdrawAvailable: ready,
            updatedAt: new Date().toISOString(),
          };
        },
      ),
    );
    const earnings = await this.records.earnings(userId, positions);
    return { products, ...earnings };
  }
  async quote(userId: string, dto: EarnRequest): Promise<EarnQuote> {
    await this.infrastructure(dto.action);
    const a = await this.account(userId),
      p = EARN_PROVIDERS[dto.provider];
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
      readEarnExchangeRate(this.rpc, dto.provider),
      this.balance(
        a.addresses.vault,
        dto.action === 'deposit' ? EARN_USDC : new PublicKey(p.receipt),
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
    const instructions = buildEarnInstructions({
      ...a,
      provider: stored.provider,
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
    if (!pin || pin.userId !== userId)
      throw new BadRequestException('Earn transaction does not match');
    if (pin.signature) {
      const status = await this.rpc.getSignatureStatus(pin.signature, {
        searchTransactionHistory: true,
      });
      if (status.value) return { signature: pin.signature };
    }
    await this.infrastructure(pin.quote.action);
    if (tx.signatures.slice(1).some((s) => s.every((b) => b === 0)))
      throw new BadRequestException('Both Account signatures are required');
    if ((await this.rpc.getBlockHeight('confirmed')) > pin.blockHeight)
      throw new ConflictException({
        code: 'EARN_QUOTE_EXPIRED',
        message:
          'The approval expired. Check your balance before trying again.',
      });
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
function pinKey(message: string): string {
  return `earn:prepared:${createHash('sha256').update(message).digest('hex')}`;
}
