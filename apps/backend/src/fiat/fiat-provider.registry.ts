import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FIAT_PROVIDERS } from './fiat-provider.interface';
import type { FiatProvider, FiatRoute } from './fiat-provider.interface';
import { FiatError } from './fiat.errors';

@Injectable()
export class FiatProviderRegistry {
  constructor(
    @Inject(FIAT_PROVIDERS) private readonly providers: FiatProvider[],
    private readonly config: ConfigService,
  ) {}
  private enabled(): FiatProvider[] {
    if (this.config.get('NODE_ENV') === 'production') return [];
    const names = String(this.config.get('FIAT_ENABLED_PROVIDERS') ?? '')
      .split(',')
      .map((s) => s.trim());
    return this.providers.filter((p) => names.includes(p.name));
  }
  provider(name: string): FiatProvider {
    const provider = this.enabled().find((p) => p.name === name);
    if (!provider)
      throw new FiatError(
        'ROUTE_UNAVAILABLE',
        'This transfer provider is unavailable.',
        503,
      );
    return provider;
  }
  async routes(): Promise<FiatRoute[]> {
    const results = await Promise.allSettled(
      this.enabled().map((p) => p.routes()),
    );
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }
  async route(id: string): Promise<FiatRoute> {
    const route = (await this.routes()).find((r) => r.id === id);
    if (!route)
      throw new FiatError(
        'ROUTE_UNAVAILABLE',
        'This transfer route is unavailable.',
        503,
      );
    return route;
  }
}
