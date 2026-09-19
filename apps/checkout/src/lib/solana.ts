import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import type { PrivyClientConfig } from '@privy-io/react-auth';

/** Network is pinned by the backend Payment, never inferred from livemode. */
export function checkoutChain(cluster: string) {
  switch (cluster) {
    case 'devnet':
      return 'solana:devnet' as const;
    case 'testnet':
      return 'solana:testnet' as const;
    case 'mainnet-beta':
      return 'solana:mainnet' as const;
    default:
      throw new Error('Payment has no supported execution network');
  }
}

function rpc(host: string) {
  return {
    rpc: createSolanaRpc(`https://${host}`),
    rpcSubscriptions: createSolanaRpcSubscriptions(`wss://${host}`),
  };
}

export const solanaRpcs = {
  'solana:devnet': rpc('api.devnet.solana.com'),
  'solana:testnet': rpc('api.testnet.solana.com'),
  'solana:mainnet': rpc('api.mainnet-beta.solana.com'),
} satisfies NonNullable<NonNullable<PrivyClientConfig['solana']>['rpcs']>;
