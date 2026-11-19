import { Injectable, Logger, Module } from '@nestjs/common';

type Listener = (addresses: string[]) => Promise<void>;

/**
 * Carries "these addresses appeared in a chain delivery" from the activity
 * webhook to whoever watches Account Settings, without the webhook depending
 * on the account module that does the watching.
 */
@Injectable()
export class SettingsActivitySignal {
  private readonly logger = new Logger(SettingsActivitySignal.name);
  private readonly listeners: Listener[] = [];

  listen(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Never throws and never makes the webhook wait: a check is not a reply. */
  emit(addresses: string[]): void {
    if (addresses.length === 0) return;
    for (const listener of this.listeners) {
      listener(addresses).catch((err) =>
        this.logger.warn('settings_activity.listener_failed', err),
      );
    }
  }
}

@Module({
  providers: [SettingsActivitySignal],
  exports: [SettingsActivitySignal],
})
export class SettingsActivityModule {}
