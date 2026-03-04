import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
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
}