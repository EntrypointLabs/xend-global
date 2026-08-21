/** DI token for the active push provider. */
export const PUSH_SENDER = Symbol('PushSender');

export interface PushMessage {
  /** Provider address for one installation. */
  token: string;
  title: string;
  body: string;
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
