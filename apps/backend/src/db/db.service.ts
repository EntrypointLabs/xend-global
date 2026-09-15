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

const PING_TIMEOUT_MS = 5000;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool: Pool;
  client: NodePgDatabase<typeof schema>;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.getOrThrow('DATABASE_URL'),
      max: this.config.get<number>('DB_POOL_MAX') ?? 10,
      connectionTimeoutMillis:
        this.config.get<number>('DB_CONNECTION_TIMEOUT_MS') ?? 5000,
      idleTimeoutMillis: this.config.get<number>('DB_IDLE_TIMEOUT_MS') ?? 30000,
    });
    // An idle client dropped by the server emits here; unhandled, it is an
    // uncaught exception that takes the process down.
    this.pool.on('error', (err: Error) => {
      this.logger.error(`db.pool.error message=${err.message}`);
    });

    this.client = drizzle(this.pool, { schema });

    await this.ping(PING_TIMEOUT_MS);
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Round-trips SELECT 1, rejecting if the database does not answer in time. */
  async ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`database ping timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
    } finally {
      clearTimeout(timer);
    }
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
