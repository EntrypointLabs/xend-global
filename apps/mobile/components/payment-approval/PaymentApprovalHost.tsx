import React, { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { FullWindowOverlay } from "react-native-screens";

import { PaymentApprovalTakeover } from "@/components/payment-approval/PaymentApprovalTakeover";
import { useAuth } from "@/contexts/AuthContext";
import { useAppLock } from "@/contexts/AppLockContext";
import { useAwaitingPayments } from "@/hooks/useAwaitingPayments";
import { usePaymentApprovalFlow } from "@/hooks/usePaymentApprovalFlow";
import type { AwaitingPayment } from "@/utils/apiClient";
import {
  deferApproval,
  forgetDeferredApprovals,
  settleApproval,
  useApprovalRequests,
} from "@/utils/approvalRequests";

// Sheets and native modals draw above the root view, so on iOS the takeover
// lives in the window, as AppCover does. It is mounted before AppCover so the
// lock and the app-switcher cover still draw over it.
const Host = Platform.OS === "ios" ? FullWindowOverlay : React.Fragment;

/**
 * Puts a Payment a checkout is waiting on in front of everything, whenever
 * there is one: on a tapped notice, a deep link, or simply on opening the app.
 *
 * Never over the lock. The amount and the merchant are not for whoever picked
 * up the phone, and approving needs the Consumer anyway.
 */
export function PaymentApprovalHost() {
  const { isAuthenticated, sessionTier } = useAuth();
  const { isLocked } = useAppLock();
  const { data: payments, refetch } = useAwaitingPayments();
  const { requested, deferred } = useApprovalRequests();
  const flow = usePaymentApprovalFlow();
  // Held while the Consumer is acting on it: the list drops a Payment the
  // moment it is paid or declined, and the outcome still has to be shown.
  const [pinned, setPinned] = useState<AwaitingPayment | null>(null);

  useEffect(() => {
    if (requested) void refetch();
  }, [requested, refetch]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") forgetDeferredApprovals();
    });
    return () => sub.remove();
  }, []);

  // The server lists only unexpired quotes; one that lapses while shown is
  // the takeover's to say.
  const waiting = payments ?? [];
  const candidate =
    (requested && waiting.find((p) => p.reference === requested)) ||
    waiting.find((p) => !deferred.has(p.reference)) ||
    null;
  const payment = pinned ?? candidate;

  const close = useCallback(() => {
    if (payment) {
      settleApproval(payment.reference);
      deferApproval(payment.reference);
    }
    setPinned(null);
    flow.reset();
  }, [flow, payment]);

  const later = useCallback(() => {
    if (payment) deferApproval(payment.reference);
    setPinned(null);
    flow.reset();
  }, [flow, payment]);

  if (!isAuthenticated || sessionTier !== "full" || isLocked || !payment) {
    return null;
  }

  return (
    <Host>
      <PaymentApprovalTakeover
        key={payment.reference}
        payment={payment}
        phase={flow.phase}
        onApprove={() => {
          setPinned(payment);
          void flow.approve(payment);
        }}
        onDecline={() => {
          setPinned(payment);
          void flow.decline(payment);
        }}
        onLater={later}
        onClose={close}
      />
    </Host>
  );
}
