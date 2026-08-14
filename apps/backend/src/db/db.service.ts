import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool: Pool;
  client: NodePgDatabase<typeof schema>;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.getOrThrow('DATABASE_URL'),
    });

    this.client = drizzle(this.pool, { schema });

    // verify connection on startup
    await this.pool.query('SELECT 1');
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /**
   * Runs `fn` while holding a Postgres advisory lock on `key`, serialising
   * callers across every process sharing this database.
   *
   * Held on one checked-out connection for the whole call rather than through
   * `client`, which takes a fresh connection per statement: a session lock
   * taken on one connection and released on another is not a lock at all.
   *
   * `key` is hashed to the bigint the lock space uses. A collision between two
   * unrelated keys costs one caller a wait, never correctness.
   */
  async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        'SELECT pg_advisory_lock(hashtextextended($1, 0))',
        [key],
      );
      try {
        return await fn();
      } finally {
        await connection.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [key],
        );
      }
    } finally {
      connection.release();
    }
  }
}
