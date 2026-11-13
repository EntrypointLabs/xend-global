import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DbService } from './db.service';

describe('DbService', () => {
  let service: DbService;

  beforeEach(async () => {
    // compile() instantiates providers without running lifecycle hooks, so
    // onModuleInit never opens a Postgres pool. A stub ConfigService is all
    // DI needs to resolve DbService's ConfigService dependency.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'postgresql://localhost:5432/test' },
        },
      ],
    }).compile();

    service = module.get<DbService>(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('runs after-commit callbacks only after a transaction commits', async () => {
    const tx = {};
    service.client = {
      transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as never;
    const callback = jest.fn();

    await service.withTransaction(() => {
      service.afterCommit(callback);
      expect(callback).not.toHaveBeenCalled();
      return Promise.resolve();
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('discards after-commit callbacks when a transaction rolls back', async () => {
    const tx = {};
    service.client = {
      transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as never;
    const callback = jest.fn();

    await expect(
      service.withTransaction(() => {
        service.afterCommit(callback);
        return Promise.reject(new Error('insert failed'));
      }),
    ).rejects.toThrow('insert failed');

    expect(callback).not.toHaveBeenCalled();
  });
});
