import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getInitializeAccount3Instruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { SOLANA_RPC, type SolanaRpc } from '../../solana/solana-rpc.interface';
import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement-authority.interface';
import {
  SettlementAccountNotProvisionedError,
  RefundNotSupportedError,
} from '../settlement.errors';
import type {
  ProvisionedSettlementEndpoint,
  SettlementCompletion,
  SettlementProvider,
  SettlementProviderCapabilities,
} from '../settlement-provider.interface';

/** A classic-SPL token account is 165 bytes. */
const TOKEN_ACCOUNT_SPACE = 165n;
const USDC_DECIMALS = 6;

/**
 * The pilot settlement adapter: USDC settles directly into a Xend-authority-
 * owned classic-SPL token account (REQ-PLAIN-SPL, so the Phase 3 relayer
 * checks stay valid). Each Merchant gets a DISTINCT authority-owned token
 * account, enumerable from the authority root (REQ-ATTRIBUTABLE). Refunds
 * are authority-signed USDC transfers back to the Consumer. Blockradar
 * (naira, convert-at-settlement) is a separate adapter added in Phase 8
 * behind this same seam.
 */
@Injectable()
export class DirectUsdcProvider implements SettlementProvider, OnModuleInit {
  private readonly logger = new Logger(DirectUsdcProvider.name);
  private usdcMint!: string;

  readonly capabilities: SettlementProviderCapabilities = {
    provider: 'direct_usdc',
    currencies: ['USDC'],
    refundSupport: true,
    settlementLatency: 'instant',
  };

  constructor(
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.usdcMint = this.config.getOrThrow<string>(
      'EXPO_PUBLIC_USDC_MINT_ADDRESS',
    );
  }

  async provision(params: {
    merchantId: string;
    merchantAddress?: string;
  }): Promise<ProvisionedSettlementEndpoint> {
    const usdcMint = address(this.usdcMint);

    // Recorded merchant-own variant: no funds under Xend control, no
    // attribution root, reverse() unsupported. Not the pilot default.
    if (params.merchantAddress) {
      const exists = await this.solana.accountExists(params.merchantAddress);
      if (!exists) {
        throw new SettlementAccountNotProvisionedError(
          `merchant address ${params.merchantAddress} does not exist on chain`,
        );
      }
      const [ata] = await findAssociatedTokenPda({
        owner: address(params.merchantAddress),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: usdcMint,
      });
      // The ATA is a PDA; deriving it does not create it. If the merchant has
      // never initialized their USDC ATA, settlement would build a
      // TransferChecked to a nonexistent token account and fail at simulation
      // for every payment. Fail loud at provisioning instead of returning an
      // unusable destination. (Auto-creating the ATA under the authority is a
      // possible future enhancement; the pilot uses the authority-owned variant
      // below, so this path stays verify-only.)
      const ataExists = await this.solana.accountExists(ata);
      if (!ataExists) {
        throw new SettlementAccountNotProvisionedError(
          `merchant ${params.merchantId} has no USDC token account at ${ata}; create the USDC ATA before provisioning this settlement destination`,
        );
      }
      return {
        address: ata,
        providerReference: params.merchantAddress,
        attributionRef: null,
        payoutConfig: null,
      };
    }

    // Default: a distinct per-Merchant Xend-authority-owned USDC token
    // account. A fresh ephemeral keypair is the new account; the authority
    // is payer + owner, so the account is enumerable from the authority
    // root and the authority alone signs future transfers (refunds). The
    // ephemeral key is discarded after creation.
    const ephemeral = await generateKeyPairSigner();
    const payer = createNoopSigner(address(this.authority.address));
    const rent =
      await this.solana.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE);
    const { blockhash, lastValidBlockHeight } =
      await this.solana.getRecentBlockhash();

    const createIx = getCreateAccountInstruction({
      payer,
      newAccount: ephemeral,
      lamports: rent,
      space: TOKEN_ACCOUNT_SPACE,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    });
    const initIx = getInitializeAccount3Instruction({
      account: ephemeral.address,
      mint: usdcMint,
      owner: address(this.authority.address),
    });

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(this.authority.address), m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash as Blockhash,
            lastValidBlockHeight: BigInt(lastValidBlockHeight),
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions([createIx, initIx], m),
    );
    // Sign with the embedded ephemeral new-account keypair; the authority
    // (fee payer) signature is added and broadcast by the authority signer.
    const partiallySigned =
      await partiallySignTransactionMessageWithSigners(message);
    const wire = getBase64EncodedWireTransaction(partiallySigned);
    await this.authority.signAndSend(wire);

    return {
      address: ephemeral.address,
      providerReference: ephemeral.address,
      attributionRef: this.authority.address,
      payoutConfig: null,
    };
  }

  /**
   * direct-USDC: the USDC landing on-chain IS settlement, so this returns
   * complete synchronously with the optionals undefined (they carry only on
   * the deferred naira path). Trivially idempotent per signature (no side
   * effect). The Blockradar adapter (Phase 8) returns pending here and
   * completes on the naira payout signal, and MUST make its convert-payout
   * side effect idempotent per signature.
   */
  handleIncomingSettlement(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: {
      endpointAddress: string;
      signature: string;
      amountRaw: string;
    },
  ): Promise<SettlementCompletion> {
    return Promise.resolve({ status: 'complete' });
  }

  async reverse(params: {
    endpointAddress: string;
    consumerAddress: string;
    amountRaw: string;
    paymentId: string;
  }): Promise<{ signature: string }> {
    // Only an authority-owned endpoint can be reversed: a recorded
    // merchant-own address has no Xend signer, so ops handles it manually.
    const owner = await this.solana.getTokenAccountOwner(
      params.endpointAddress,
    );
    if (owner !== this.authority.address) {
      throw new RefundNotSupportedError(
        `settlement endpoint ${params.endpointAddress} is not authority-owned; refund must be handled manually by ops`,
      );
    }

    const usdcMint = address(this.usdcMint);
    const [consumerAta] = await findAssociatedTokenPda({
      owner: address(params.consumerAddress),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: usdcMint,
    });
    const { blockhash, lastValidBlockHeight } =
      await this.solana.getRecentBlockhash();

    const transferIx = getTransferCheckedInstruction({
      source: address(params.endpointAddress),
      mint: usdcMint,
      destination: consumerAta,
      authority: address(this.authority.address),
      amount: BigInt(params.amountRaw),
      decimals: USDC_DECIMALS,
    });

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(this.authority.address), m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash as Blockhash,
            lastValidBlockHeight: BigInt(lastValidBlockHeight),
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions([transferIx], m),
    );
    const compiled = compileTransaction(message);
    const wire = getBase64EncodedWireTransaction(compiled);
    const signature = await this.authority.signAndSend(wire);
    this.logger.log(
      `settlement.reverse payment_id=${params.paymentId} endpoint=${params.endpointAddress} signature=${signature}`,
    );
    return { signature };
  }

  async report(params: {
    endpointAddress: string;
  }): Promise<{ balanceRaw: string; providerReference: string }> {
    const balanceRaw = await this.solana.getTokenAccountBalanceRaw(
      params.endpointAddress,
    );
    return { balanceRaw, providerReference: params.endpointAddress };
  }
}
