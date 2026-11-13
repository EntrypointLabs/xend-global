import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { AwaitingPaymentSchema, type AwaitingPayment } from "@/utils/apiClient";
import { userScopedKey } from "@/utils/storage";

export type PendingPaymentSubmission = {
  payment: AwaitingPayment;
  signedTransactionBase64: string;
};

const INDEX_PREFIX = "xend.pending_payment_submissions";
const PAYLOAD_PREFIX = "xend.pending_payment_transaction";

const indexKey = (userId: string) => userScopedKey(INDEX_PREFIX, userId);
const payloadKey = (userId: string, reference: string) =>
  userScopedKey(PAYLOAD_PREFIX, `${userId}.${reference}`);

async function readIndex(
  userId: string
): Promise<Record<string, AwaitingPayment>> {
  const raw = await AsyncStorage.getItem(indexKey(userId));
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};

    const valid: Record<string, AwaitingPayment> = {};
    for (const [reference, candidate] of Object.entries(parsed)) {
      const payment = AwaitingPaymentSchema.safeParse(candidate);
      if (payment.success && payment.data.reference === reference) {
        valid[reference] = payment.data;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

async function writeIndex(
  userId: string,
  index: Record<string, AwaitingPayment>
): Promise<void> {
  if (Object.keys(index).length === 0) {
    await AsyncStorage.removeItem(indexKey(userId));
    return;
  }
  await AsyncStorage.setItem(indexKey(userId), JSON.stringify(index));
}

/**
 * Load signed Payments that still need a server acknowledgement. Metadata is
 * indexed in AsyncStorage while the signed transaction itself stays in the
 * platform keychain. An incomplete entry is removed instead of offering a
 * retry with different bytes.
 */
export async function loadPendingPaymentSubmissions(
  userId: string
): Promise<Record<string, PendingPaymentSubmission>> {
  const index = await readIndex(userId);
  const loaded: Record<string, PendingPaymentSubmission> = {};
  let changed = false;

  await Promise.all(
    Object.entries(index).map(async ([reference, payment]) => {
      const signedTransactionBase64 = await SecureStore.getItemAsync(
        payloadKey(userId, reference)
      );
      if (!signedTransactionBase64) {
        delete index[reference];
        changed = true;
        return;
      }
      loaded[reference] = { payment, signedTransactionBase64 };
    })
  );

  if (changed) await writeIndex(userId, index);
  return loaded;
}

/** Persist the exact signed bytes before attempting the network submission. */
export async function savePendingPaymentSubmission(
  userId: string,
  pending: PendingPaymentSubmission
): Promise<void> {
  const { payment, signedTransactionBase64 } = pending;
  await SecureStore.setItemAsync(
    payloadKey(userId, payment.reference),
    signedTransactionBase64
  );
  const index = await readIndex(userId);
  index[payment.reference] = payment;
  await writeIndex(userId, index);
}

/** Remove durable retry material only after acknowledgement or terminal state. */
export async function deletePendingPaymentSubmission(
  userId: string,
  reference: string
): Promise<void> {
  const index = await readIndex(userId);
  delete index[reference];
  await writeIndex(userId, index);
  await SecureStore.deleteItemAsync(payloadKey(userId, reference));
}
