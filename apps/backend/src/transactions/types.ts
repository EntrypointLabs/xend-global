import { SignAndSendRequest } from '@sqds/grid';

export interface SendTransactionDto {
  toAddress: string;
  amount: string;
  token: string; // "SOL", "USDC" or mint address
  sessionSecrets: SignAndSendRequest['sessionSecrets'];
  session: SignAndSendRequest['session'];
}
