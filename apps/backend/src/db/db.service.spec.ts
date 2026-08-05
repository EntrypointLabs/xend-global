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
});
