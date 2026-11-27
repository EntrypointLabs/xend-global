import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';
import type { ServerEventName, ServerEventProps } from './server-events';

const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Who an event belongs to. Matches the id each app passes to `identify`. */
export type EventSubject =
  | { consumerId: string }
  | { merchantId: string }
  | { anonymous: string };

@Injectable()
export class ServerAnalytics implements OnApplicationShutdown {
  private readonly logger = new Logger(ServerAnalytics.name);
  private readonly client: PostHog | null;
  private readonly symbols = new Map<string, string>([
    [WRAPPED_SOL_MINT, 'SOL'],
  ]);

  constructor(config: ConfigService) {
    for (const [symbol, setting] of [
      ['USDC', 'EXPO_PUBLIC_USDC_MINT_ADDRESS'],
      ['USDT', 'EXPO_PUBLIC_USDT_MINT_ADDRESS'],
    ]) {
      const mint = config.get<string>(setting)?.trim();
      if (mint) this.symbols.set(mint, symbol);
    }
    const key = config.get<string>('POSTHOG_KEY')?.trim();
    this.client = key
      ? new PostHog(key, {
          host:
            config.get<string>('POSTHOG_HOST') || 'https://us.i.posthog.com',
          flushAt: 20,
          flushInterval: 10_000,
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * A mint as a ticker for the `token` prop. Mints we do not list come back as
   * `other` rather than as the address, so a prop never carries one.
   */
  tokenSymbol(mint: string | null | undefined): string | undefined {
    if (!mint) return undefined;
    return this.symbols.get(mint) ?? 'other';
  }

  /** Never throws and never awaits the network: analytics cannot fail a request. */
  capture(
    event: ServerEventName,
    subject: EventSubject,
    props: ServerEventProps = {},
  ): void {
    if (!this.client) return;
    try {
      const properties: Record<string, unknown> = {
        ...props,
        source: 'server',
      };
      let distinctId: string;
      if ('consumerId' in subject) distinctId = subject.consumerId;
      else if ('merchantId' in subject) distinctId = subject.merchantId;
      else {
        distinctId = subject.anonymous;
        properties.$process_person_profile = false;
      }
      for (const key of Object.keys(properties)) {
        if (properties[key] === undefined) delete properties[key];
      }
      this.client.capture({ distinctId, event, properties });
    } catch (err) {
      this.logger.warn(
        `analytics.capture_failed event=${event} err=${String(err)}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.shutdown().catch(() => undefined);
  }
}
