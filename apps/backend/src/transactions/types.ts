import { SignAndSendRequest } from '@sqds/grid';

export interface SendTransactionDto {
  toAddress: string;
  /** Decimal-string amount, e.g. "0.10". Backend converts to base units via TOKEN_DECIMALS. */
  amount: string;
  /** Token symbol — only "USDC" is supported for v1. Unknown tokens throw in toBaseUnits. */
  token: string;
  sessionSecrets: SignAndSendRequest['sessionSecrets'];
  session: SignAndSendRequest['session'];
}
