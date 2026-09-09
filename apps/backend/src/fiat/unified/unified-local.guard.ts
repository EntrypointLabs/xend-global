import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../../db/db.service';
import { users } from '../../db/schema';

export const LOCAL_SIMULATION_OWNER = 'local-unified-simulation';

@Injectable()
export class UnifiedLocalGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      socket: { remoteAddress?: string };
      headers: Record<string, string | undefined>;
      user?: { userId: string };
    }>();
    const enabled = this.config.get<boolean | string>('FIAT_LOCAL_DEMO');
    if (
      this.config.get<string>('NODE_ENV') !== 'development' ||
      (enabled !== true && enabled !== 'true') ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress ?? '',
      ) ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
        req.headers.host ?? '',
      ) ||
      req.headers['x-xend-local-simulation'] !== '1' ||
      req.headers.origin ||
      req.headers.forwarded ||
      req.headers['x-forwarded-for']
    )
      throw new NotFoundException();
    await this.db.client
      .insert(users)
      .values({ id: LOCAL_SIMULATION_OWNER })
      .onConflictDoNothing();
    req.user = { userId: LOCAL_SIMULATION_OWNER };
    return true;
  }
}
