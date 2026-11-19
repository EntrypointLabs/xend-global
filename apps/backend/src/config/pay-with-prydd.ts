import type { ConfigService } from '@nestjs/config';

export function payWithPryddEnabled(config: ConfigService): boolean {
  const value = config.get<boolean | string>('PAY_WITH_PRYDD_ENABLED');
  return value === true || value === 'true' || value === '1';
}
