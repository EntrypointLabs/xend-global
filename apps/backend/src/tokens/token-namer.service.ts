import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WRAPPED_SOL_MINT } from '../solana/web3-connection';
import { TOKEN_METADATA_PROVIDER } from './token-metadata.interface';
import type { TokenMetadataProvider } from './token-metadata.interface';

/**
 * What to call a mint.
 *
 * Answers from what this deployment knows before asking the index, for the
 * same reason the client does: the index covers mainnet, so on a test network
 * the mints a Consumer actually holds are exactly the ones it cannot name.
 * Native SOL and the cluster's own stablecoins are therefore answered locally.
 *
 * An empty string means nothing could name it. Callers show the amount alone
 * rather than inventing a ticker.
 */
@Injectable()
export class TokenNamer {
  constructor(
    @Inject(TOKEN_METADATA_PROVIDER)
    private readonly metadata: TokenMetadataProvider,
    private readonly config: ConfigService,
  ) {}

  async symbolFor(mint: string): Promise<string> {
    const local = this.localSymbols().get(mint);
    if (local) return local;

    try {
      return (await this.metadata.getMetadata([mint])).get(mint)?.symbol ?? '';
    } catch {
      // Naming is decoration. Whatever needed the name has something more
      // important to get on with.
      return '';
    }
  }

  private localSymbols(): Map<string, string> {
    const symbols = new Map<string, string>([[WRAPPED_SOL_MINT, 'SOL']]);
    const usdc = this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS');
    const usdt = this.config.get<string>('EXPO_PUBLIC_USDT_MINT_ADDRESS');
    if (usdc) symbols.set(usdc, 'USDC');
    if (usdt) symbols.set(usdt, 'USDT');
    return symbols;
  }
}
