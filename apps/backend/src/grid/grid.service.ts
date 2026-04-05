import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GridClient,
  SessionSecrets,
  CompleteAuthAndCreateAccountRequest,
  CompleteAuthRequestWithOtp,
  CreatePasskeySessionRequest,
  AddPasskeyRequest,
} from '@sqds/grid';

@Injectable()
export class GridService implements OnModuleInit {
  private readonly logger = new Logger(GridService.name);
  client: GridClient;
  private env: 'sandbox' | 'production';

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.env =
      this.config.get('NODE_ENV') === 'production' ? 'production' : 'sandbox';
    this.client = new GridClient({
      apiKey: this.config.getOrThrow('GRID_API_KEY'),
      environment: this.env,
    });
    this.logger.log(`Grid client initialized in ${this.env} mode`);
  }

  getEnv() {
    return this.env;
  }

  // ── Registration ────────────────────────────────────────────────────────

  // Step 1: create account → Grid sends OTP to email
  async createAccount(email: string) {
    return this.client.createAccount({ email });
  }

  // Step 2: verify OTP → Grid creates smart account automatically
  async completeAuthAndCreateAccount(
    request: CompleteAuthAndCreateAccountRequest,
  ) {
    return this.client.completeAuthAndCreateAccount(request);
  }

  // ── Login ───────────────────────────────────────────────────────────────

  // Step 1: init auth → Grid sends OTP to email
  async initAuth(email: string) {
    return this.client.initAuth({ email });
  }

  // Step 2: verify OTP → Grid returns session + smart account
  async completeAuth(request: CompleteAuthRequestWithOtp) {
    return this.client.completeAuth(request);
  }

  // ── Account ─────────────────────────────────────────────────────────────

  async getAccount(gridAccountId: string) {
    return this.client.getAccount(gridAccountId);
  }

  async getBalances(gridAccountId: string) {
    return this.client.getAccountBalances(gridAccountId);
  }

  async getTransfers(gridAccountId: string) {
    return this.client.getTransfers(gridAccountId);
  }

  async generateSessionSecrets(): Promise<SessionSecrets> {
    return this.client.generateSessionSecrets();
  }

  // ── Passkeys ────────────────────────────────────────────────────────

  async getPasskeys(accountAddress: string) {
    return this.client.getPasskeys(accountAddress);
  }

  async createPasskeySession(params: CreatePasskeySessionRequest) {
    return this.client.createPasskeySession(params, this.env);
  }

  async addPasskey(accountAddress: string, request: AddPasskeyRequest) {
    return this.client.addPasskey(accountAddress, request);
  }
}
