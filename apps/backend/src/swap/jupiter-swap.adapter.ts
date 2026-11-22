import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import { NoSwapRouteError } from './swap.errors';
import type { SwapPrice, SwapProvider, SwapRoute } from './swap.interface';

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Steers Jupiter toward routes small enough to travel inside a Spend. It is a
 * hint Jupiter does not hold itself to, so the caller still measures.
 */
const MAX_ROUTE_ACCOUNTS = 40;

interface JupiterInstruction {
  programId: string;
  data: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

interface JupiterQuote {
  inAmount?: string;
  outAmount?: string;
  slippageBps?: number;
  routePlan?: { swapInfo?: { label?: string } }[];
}

/**
 * Prices and routes swaps through Jupiter.
 *
 * Only the route instruction is taken from Jupiter. Its setup and cleanup
 * instructions assume a wallet that can pay rent and sign for itself, which a
 * vault cannot, so opening token accounts and wrapping SOL are built here
 * instead, in shapes the signing device recognises.
 */
@Injectable()
export class JupiterSwapAdapter implements SwapProvider {
  readonly name = 'jupiter';

  constructor(private readonly config: ConfigService) {}

  async quote(params: {
    inputMint: string;
    outputMint: string;
    amountInRaw: string;
    slippageBps: number;
    directOnly?: boolean;
  }): Promise<SwapPrice> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amountInRaw,
      slippageBps: String(params.slippageBps),
      swapMode: 'ExactIn',
      restrictIntermediateTokens: 'true',
      maxAccounts: String(MAX_ROUTE_ACCOUNTS),
    });
    if (params.directOnly) query.set('onlyDirectRoutes', 'true');
    const quote = await this.request<JupiterQuote>(`/quote?${query}`);
    if (!quote.inAmount || !quote.outAmount) {
      throw new NoSwapRouteError('No route for this pair');
    }
    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amountInRaw: quote.inAmount,
      amountOutRaw: quote.outAmount,
      slippageBps: quote.slippageBps ?? params.slippageBps,
      venue: quote.routePlan?.[0]?.swapInfo?.label ?? null,
      providerQuote: quote,
    };
  }

  async route(price: SwapPrice, vault: PublicKey): Promise<SwapRoute> {
    const built = await this.request<{
      swapInstruction?: JupiterInstruction;
      addressLookupTableAddresses?: string[];
    }>('/swap-instructions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: price.providerQuote,
        userPublicKey: vault.toBase58(),
        // Intermediate hops run through Jupiter's own accounts, so the vault
        // needs a token account for each side of the pair and no others.
        useSharedAccounts: true,
        wrapAndUnwrapSol: false,
      }),
    });
    if (!built.swapInstruction) {
      throw new NoSwapRouteError('The route could not be built');
    }
    const { programId, data, accounts } = built.swapInstruction;
    return {
      instruction: new TransactionInstruction({
        programId: new PublicKey(programId),
        data: Buffer.from(data, 'base64'),
        keys: accounts.map((account) => ({
          pubkey: new PublicKey(account.pubkey),
          isSigner: account.isSigner,
          isWritable: account.isWritable,
        })),
      }),
      lookupTables: built.addressLookupTableAddresses ?? [],
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = this.config.getOrThrow<string>('JUPITER_SWAP_API_URL');
    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new NoSwapRouteError(
        `Jupiter did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok || !body || body.error) {
      throw new NoSwapRouteError(
        `Jupiter refused (${response.status}): ${body?.error ?? 'no body'}`,
      );
    }
    return body;
  }
}
