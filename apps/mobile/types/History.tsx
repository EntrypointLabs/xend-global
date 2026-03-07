type TransactionSide =
  | "send"
  | "receive"
  | "swap"
  | "card-deposit"
  | "card-withdraw";
type TransactionStatus = "success" | "pending" | "failed";

export interface Token {
  name: string;
  symbol: string;
  decimal: number;
  icon: string;
}

export interface Fee {
  amount: string;
  token: Token;
}

export interface History {
  id: string;
  type: "transaction";
  side: TransactionSide;
  amount: string;
  token: Token;
  from: string;
  to: string;
  fee: Fee | null;
  incognito: boolean;
  status: TransactionStatus;
  date: string;
  transactionHash: string;
}
