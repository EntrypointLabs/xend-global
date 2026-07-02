import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import { eq, and, lt, or, desc, sql } from 'drizzle-orm';
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { SQL } from 'drizzle-orm';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { DbService } from '../db/db.service';
import { smartAccounts, transfers } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import {
  InvalidRecipientError,
  IntentExpiredError,
  IntentMismatchError,
  RpcUnavailableError,
  UnsupportedMintError,
} from './transfer.errors';
import type {
  ListTransfersResponse,
  PrepareResponse,
  SubmitResponse,
  TransferRow,
} from './dtos';

/**
 * In-memory record of a prepared transfer intent. Stored only between
 * /transfers/prepare and /transfers/submit; once submit lands the intent
 * is erased and the canonical row lives in the `transfers` table
 * (idempotency on intentId is enforced by the UNIQUE index on
 * `transfers.intent_id`).
 *
 * An in-memory Map keyed by intentId with a 5-min TTL is sufficient
 * because:
 *   - Blockhash lifetime is ~60-90 seconds; intents do not need to
 *     survive longer than that.
 *   - The prepare -> submit round-trip in normal UX is single-digit
 *     seconds.
 *   - Server restart between prepare and submit is rare, and the mobile
 *     app retries with a fresh prepare anyway.
 *
 * A `transfer_intents` table could be added later if intent durability
 * across restarts is ever needed; today it is not on the success path.
 */
interface IntentRecord {
  intentId: string;
  smartAccountId: string;
  walletAddress: string;
  toAddress: string;
  mint: string;
  amountRaw: string;
  memo?: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /**
   * Base64 of the compiled v0 message the backend built. submit() requires the
   * client's signed transaction to carry this exact message, so the broadcast
   * tx can't diverge from the recorded intent.
   */
  messageBase64: string;
  /** Unix millis */
  createdAt: number;
  /** Unix millis */
  expiresAt: number;
}

const INTENT_TTL_MS = 5 * 60 * 1000;
/** Approximate slot duration; 150 slots * 400ms ~= 60s blockhash lifetime. */
const SLOT_MS = 400;
const BLOCKHASH_LIFETIME_SLOTS = 150;

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);
  private readonly intents = new Map<string, IntentRecord>();
  /** Set of mint pubkeys we accept for /transfers/prepare in v1. */
  private readonly mintAllowlist = new Set<string>();

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
  ) {
    // Pull the stablecoin mint allowlist from env so devnet vs mainnet
    // mints can swap without code changes.
    const usdc = this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS');
    const usdt = this.config.get<string>('EXPO_PUBLIC_USDT_MINT_ADDRESS');
    if (usdc) this.mintAllowlist.add(usdc);
    if (usdt) this.mintAllowlist.add(usdt);
  }

  // ── prepare ────────────────────────────────────────────────────────

  async prepare(
    userId: string,
    req: {
      toAddress: string;
      mint: string;
      amountRaw: string;
      memo?: string;
    },
  ): Promise<PrepareResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);
    if (!account) throw new NotFoundException('Wallet not found');

    const fromAddress = account.walletAddress;

    // 1. Validate the recipient pubkey.
    let toPk: PublicKey;
    try {
      toPk = new PublicKey(req.toAddress);
    } catch {
      throw new InvalidRecipientError('toAddress is not a valid Solana pubkey');
    }
    let fromPk: PublicKey;
    try {
      fromPk = new PublicKey(fromAddress);
    } catch {
      // Should not happen — we stored the address ourselves — but
      // defensive: surface as an internal data error.
      throw new InvalidRecipientError('sender wallet address malformed');
    }
    if (toPk.equals(fromPk)) {
      throw new InvalidRecipientError('self-send not allowed');
    }

    // 2. Validate the mint against the allowlist.
    if (!this.mintAllowlist.has(req.mint)) {
      throw new UnsupportedMintError(
        `mint ${req.mint} not in supported set for v1`,
      );
    }
    let mintPk: PublicKey;
    try {
      mintPk = new PublicKey(req.mint);
    } catch {
      throw new UnsupportedMintError(`mint ${req.mint} not a valid pubkey`);
    }

    // 3. Decimals — both USDC and USDT use 6 decimals on Solana. The
    //    allowlist is closed in v1; if we later open it to arbitrary
    //    mints we will need an on-chain getMint fetch. Pinning here
    //    keeps the prepare path 1 RPC round-trip (just the blockhash)
    //    plus 1 cheap getAccountInfo for ATA existence.
    const decimals = 6;

    // 4. Recent blockhash. Wrapped in try/catch so an RPC outage maps
    //    cleanly to RPC_UNAVAILABLE.
    let blockhashInfo: { blockhash: string; lastValidBlockHeight: number };
    try {
      blockhashInfo = await this.solana.getRecentBlockhash();
    } catch (err) {
      throw new RpcUnavailableError('failed to fetch recent blockhash', err);
    }

    // 5. Derive ATAs. We use the classic SPL Token program (USDC and
    //    USDT mainnet mints both live under TOKEN_PROGRAM_ID, not
    //    Token-2022). If we ever add a Token-2022 mint to the
    //    allowlist we will need to branch here.
    const fromAta = getAssociatedTokenAddressSync(
      mintPk,
      fromPk,
      false,
      TOKEN_PROGRAM_ID,
    );
    const toAta = getAssociatedTokenAddressSync(
      mintPk,
      toPk,
      false,
      TOKEN_PROGRAM_ID,
    );

    // 6. Check recipient ATA existence; if missing, we prepend a
    //    createAssociatedTokenAccount instruction so the sender pays
    //    the rent (small SOL cost).
    let recipientAtaExists: boolean;
    try {
      recipientAtaExists = await this.solana.accountExists(toAta.toBase58());
    } catch (err) {
      throw new RpcUnavailableError(
        'failed to check recipient ATA existence',
        err,
      );
    }

    const instructions: TransactionInstruction[] = [];
    if (!recipientAtaExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          fromPk, // payer
          toAta, // associated token account to create
          toPk, // owner of new ATA
          mintPk,
          TOKEN_PROGRAM_ID,
        ),
      );
    }
    let amountBig: bigint;
    try {
      amountBig = BigInt(req.amountRaw);
    } catch {
      throw new InvalidRecipientError(
        `amountRaw must be a non-negative integer string`,
      );
    }
    instructions.push(
      createTransferCheckedInstruction(
        fromAta,
        mintPk,
        toAta,
        fromPk,
        amountBig,
        decimals,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    // 7. Build v0 transaction message.
    const messageV0 = new TransactionMessage({
      payerKey: fromPk,
      recentBlockhash: blockhashInfo.blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(messageV0);
    const unsignedTxBase64 = Buffer.from(tx.serialize()).toString('base64');
    const messageBase64 = Buffer.from(messageV0.serialize()).toString('base64');

    // 8. Persist intent in-memory with TTL.
    const intentId = createId();
    const now = Date.now();
    // expiresAt: blockhash lifetime upper bound. lastValidBlockHeight is
    // a slot height that cannot be translated directly to wall time
    // without a current-slot read, so use the conservative upper bound
    // BLOCKHASH_LIFETIME_SLOTS * SLOT_MS = 60_000 ms from now.
    const expiresAt =
      now + Math.min(BLOCKHASH_LIFETIME_SLOTS * SLOT_MS, INTENT_TTL_MS);

    this.intents.set(intentId, {
      intentId,
      smartAccountId: account.id,
      walletAddress: fromAddress,
      toAddress: req.toAddress,
      mint: req.mint,
      amountRaw: req.amountRaw,
      memo: req.memo,
      blockhash: blockhashInfo.blockhash,
      lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
      messageBase64,
      createdAt: now,
      expiresAt,
    });

    // Best-effort cleanup of obviously-stale entries to keep the Map
    // bounded. Not a substitute for TTL-on-read, which is the
    // authoritative check during submit().
    this.pruneIntents();

    return {
      intentId,
      unsignedTxBase64,
      // feeLamports is the transaction fee, not total cost. Estimating
      // the actual fee requires a simulateTransaction round-trip; the
      // fixed base fee is 5000 lamports per signature, and with a single
      // signer (the sender) the floor is 5000. ATA-create rent
      // (~2_039_280 lamports) is deliberately excluded here.
      feeLamports: 5000,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  // ── submit ─────────────────────────────────────────────────────────

  async submit(
    userId: string,
    req: { intentId: string; signedTxBase64: string },
  ): Promise<SubmitResponse> {
    // 1. Idempotency: if a transfer row already exists for this
    //    intentId, return it directly. transfers.intent_id is UNIQUE
    //    so the lookup is cheap. Done BEFORE intent-TTL check so a
    //    successful submit followed by an expired-intent replay still
    //    returns the existing row.
    const [existing] = await this.db.client
      .select()
      .from(transfers)
      .where(eq(transfers.intentId, req.intentId))
      .limit(1);
    if (existing) {
      return {
        transferId: existing.id,
        signature: existing.signature ?? '',
        status: 'PENDING',
      };
    }

    // 2. Look up the intent.
    const intent = this.intents.get(req.intentId);
    if (!intent || intent.expiresAt < Date.now()) {
      // Drop it if expired so the Map doesn't grow.
      if (intent) this.intents.delete(req.intentId);
      throw new IntentExpiredError(
        'intent not found or blockhash past lifetime; reissue /transfers/prepare',
      );
    }

    // Confirm the intent belongs to the calling user. We do not
    // implement cross-user lookup elsewhere, but a defensive check
    // here means a stolen intentId from another session cannot be
    // submitted under the wrong JWT.
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);
    if (!account || account.id !== intent.smartAccountId) {
      throw new IntentExpiredError('intent does not match authenticated user');
    }

    // 3. Bind the signed transaction to the prepared intent. Signing only
    //    adds signatures, so the message must byte-match the one we built;
    //    any difference means the client signed a different transfer (other
    //    recipient/mint/amount) and the recorded row would not reflect the
    //    on-chain effect.
    let signedTx: VersionedTransaction;
    try {
      signedTx = VersionedTransaction.deserialize(
        Buffer.from(req.signedTxBase64, 'base64'),
      );
    } catch {
      throw new IntentMismatchError(
        'signedTxBase64 is not a valid transaction',
      );
    }
    const submittedMessage = Buffer.from(signedTx.message.serialize()).toString(
      'base64',
    );
    if (submittedMessage !== intent.messageBase64) {
      throw new IntentMismatchError(
        'signed transaction does not match the prepared intent',
      );
    }
    // Require a real signature so we never broadcast an unsigned transaction
    // (which fails on-chain yet would still write a bogus PENDING row).
    const isSigned = signedTx.signatures.some((sig) =>
      sig.some((b) => b !== 0),
    );
    if (!isSigned) {
      throw new IntentMismatchError(
        'signed transaction is missing a signature',
      );
    }

    // 4. Submit via SolanaRpc. RPC failure -> RPC_UNAVAILABLE (502) with
    //    NO DB write, so prepare/submit stays atomic.
    let signature: string;
    try {
      signature = await this.solana.sendRawTransaction(req.signedTxBase64);
    } catch (err) {
      throw new RpcUnavailableError(
        'sendRawTransaction failed; no transfer row written',
        err,
      );
    }

    // 5. Write the canonical row. Always inserted PENDING; the RPC tailer
    //    flips it to CONFIRMED or FAILED later.
    //
    //    The wallet's webhook subscription is already live, so between
    //    sendRawTransaction resolving above and this write, Helius may have
    //    delivered the confirmed transfer and TailerService may have already
    //    INSERTed a CONFIRMED row for this signature. A plain insert would
    //    violate UNIQUE(signature) and surface a 500 for a transfer that
    //    actually succeeded. Upsert on signature instead: adopt the
    //    webhook-created row by backfilling the submit-owned columns
    //    (intent_id, submitted_at) while preserving the status guard — a
    //    CONFIRMED/FAILED row must never regress to PENDING.
    const now = new Date();
    const [row] = await this.db.client
      .insert(transfers)
      .values({
        smartAccountId: intent.smartAccountId,
        intentId: intent.intentId,
        signature,
        direction: 'SEND',
        mint: intent.mint,
        amountRaw: intent.amountRaw,
        fromAddress: intent.walletAddress,
        toAddress: intent.toAddress,
        status: 'PENDING',
        submittedAt: now,
      })
      .onConflictDoUpdate({
        target: transfers.signature,
        set: {
          intentId: sql`COALESCE(${transfers.intentId}, excluded.intent_id)`,
          submittedAt: sql`COALESCE(${transfers.submittedAt}, excluded.submitted_at)`,
          status: sql`CASE
            WHEN ${transfers.status} IN ('CONFIRMED', 'FAILED')
              THEN ${transfers.status}
            ELSE excluded.status
          END`,
        },
      })
      .returning();

    // 6. Erase the intent — it has served its purpose.
    this.intents.delete(req.intentId);

    return {
      transferId: row.id,
      signature,
      status: 'PENDING',
    };
  }

  // ── list ───────────────────────────────────────────────────────────

  async list(
    userId: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<ListTransfersResponse> {
    const limit = Math.min(opts.limit ?? 20, 100);

    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);
    if (!account) throw new NotFoundException('Wallet not found');

    // Opaque cursor: base64({ createdAt: ISO, id: text }), paired with an
    // ORDER BY (createdAt DESC, id DESC) for stable reverse-chrono paging.
    let cursorWhere: SQL | undefined = undefined;
    if (opts.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(opts.cursor, 'base64').toString('utf-8'),
        ) as { createdAt: string; id: string };
        const cursorDate = new Date(decoded.createdAt);
        cursorWhere = or(
          lt(transfers.createdAt, cursorDate),
          and(
            eq(transfers.createdAt, cursorDate),
            lt(transfers.id, decoded.id),
          ),
        );
      } catch {
        // Bad cursor — treat as no cursor.
        this.logger.warn(`Invalid cursor; ignoring: ${opts.cursor}`);
      }
    }

    const rows = await this.db.client
      .select()
      .from(transfers)
      .where(
        cursorWhere
          ? and(eq(transfers.smartAccountId, account.id), cursorWhere)
          : eq(transfers.smartAccountId, account.id),
      )
      .orderBy(desc(transfers.createdAt), desc(transfers.id))
      .limit(limit + 1); // fetch +1 to know if there's a next page

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
          }),
        ).toString('base64')
      : null;

    return {
      transfers: page.map(
        (r): TransferRow => ({
          id: r.id,
          direction: r.direction,
          mint: r.mint,
          amountRaw: r.amountRaw,
          fromAddress: r.fromAddress,
          toAddress: r.toAddress,
          status: r.status,
          signature: r.signature ?? null,
          // The transfers schema has no `memo` column yet, so expose null
          // until one is added and backfilled.
          memo: null,
          createdAt: r.createdAt.toISOString(),
          confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
        }),
      ),
      nextCursor,
    };
  }

  // ── internals ──────────────────────────────────────────────────────

  /** Test-only / introspection helper. */
  intentCount(): number {
    return this.intents.size;
  }

  private pruneIntents(): void {
    const now = Date.now();
    for (const [id, intent] of this.intents) {
      if (intent.expiresAt < now) this.intents.delete(id);
    }
  }
}
