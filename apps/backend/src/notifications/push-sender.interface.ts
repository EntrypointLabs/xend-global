/** DI token for the active push provider. */
export const PUSH_SENDER = Symbol('PushSender');

/**
 * What a notice is about, and by extension where tapping it should land.
 *
 * Every notice carries one. A notification that opens the app and leaves the
 * Consumer to go and find the thing it was about has told them something is
 * wrong and then made the finding their problem.
 */
export const NOTICE_KIND = {
  /** Money arrived. Lands on Activity, where the row is. */
  arrival: 'arrival',
  /** Something is changing on the Account. Lands home, where the notice is. */
  securityAlert: 'security_alert',
  /**
   * A settings change is waiting out its delay. Lands on the review of that
   * change, which is the only screen that offers to reject it.
   */
  pendingChange: 'pending_change',
  /** A Merchant is waiting. Lands on the Payment they have to finish. */
  paymentApproval: 'payment_approval',
} as const;

export type NoticeKind = (typeof NOTICE_KIND)[keyof typeof NOTICE_KIND];

export interface PushMessage {
  /** Provider address for one installation. */
  token: string;
  title: string;
  body: string;
  /**
   * What the notice is about, carried so the app can open the right screen
   * when it is tapped. Read by the device, never shown.
   */
  data?: { kind: NoticeKind };
}

export interface PushSender {
  /**
   * Delivers to every token given.
   *
   * Returns the tokens the provider rejected as permanently invalid, so the
   * caller can forget them. A device that has been reinstalled or wiped keeps
   * its old token alive in our table forever otherwise, and every future
   * notification pays to deliver to nobody.
   *
   * Never throws for a delivery failure: a notification is not worth failing
   * the thing that triggered it.
   */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}
