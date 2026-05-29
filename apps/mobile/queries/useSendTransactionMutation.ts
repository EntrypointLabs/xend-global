import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";
import type {
  SendTransactionDto,
  TransactionRowDto,
} from "@/types/Backend";

/**
 * Submit a USDC transfer through the NestJS backend (which prepares + signs +
 * sends via Grid). Mobile passes a DECIMAL string for `amount` ("0.10"); backend
 * converts to base units via TOKEN_DECIMALS.
 *
 * `retry: false` is mandatory — Clarify #3 / PITFALLS C2. A network blip during
 * a send must NOT cause TanStack to re-attempt the POST under the hood, or the
 * user could double-spend without ever tapping Confirm twice.
 *
 * On success, both polling queries are invalidated so the new outbound tx shows
 * up immediately (the home balance and Activity tab refetch).
 *
 * Screen-level toast / SESSION_EXPIRED routing lives in (send)/confirm.tsx — this
 * hook stays transport-only.
 */
export function useSendTransactionMutation() {
  const qc = useQueryClient();
  return useMutation<TransactionRowDto, Error, SendTransactionDto>({
    mutationFn: (dto) => apiClient.sendTransaction(dto),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallet", "balances"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
