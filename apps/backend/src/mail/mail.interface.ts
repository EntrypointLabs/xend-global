export const MAILER = Symbol('MAILER');

export interface OutgoingMail {
  to: string;
  subject: string;
  /** Plain text. Every mail we send is short enough not to need markup. */
  text: string;
}

/**
 * Sends mail to a Consumer.
 *
 * The seam exists for the same reason `RecoveryVault` has one: the provider is
 * a deployment concern, and the code that needs to reach someone should not
 * know which one is configured. A deployment with no provider configured still
 * boots and still runs the flow, writing the mail to the log instead.
 */
export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}
