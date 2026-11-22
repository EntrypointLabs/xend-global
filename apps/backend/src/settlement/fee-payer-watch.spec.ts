import type { ConfigService } from '@nestjs/config';
import type { Mailer, OutgoingMail } from '../mail/mail.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { SettlementAuthoritySigner } from './settlement-authority.interface';
import { FeePayerWatchService, isFeePayerShortfall } from './fee-payer-watch';

function setup(lamports: bigint, env: Record<string, string> = {}) {
  const balance = { lamports };
  const solana = {
    getSolBalance: jest.fn(() => Promise.resolve(balance.lamports)),
  };
  const mailer = {
    send: jest.fn<Promise<void>, [OutgoingMail]>().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) =>
      ({ SUPPORT_INBOX_EMAIL: 'team@example.com', ...env })[key],
  };
  const service = new FeePayerWatchService(
    config as unknown as ConfigService,
    solana as unknown as SolanaRpc,
    { address: 'FeePayer111' } as SettlementAuthoritySigner,
    mailer as Mailer,
  );
  return { service, mailer, balance };
}

describe('fee payer watch', () => {
  it('recognises a refusal caused by the fee payer running dry', () => {
    expect(
      isFeePayerShortfall(
        new Error(
          'Simulation failed. Message: Transaction simulation failed: Transaction results in an account (0) with insufficient funds for rent.',
        ),
      ),
    ).toBe(true);
    expect(isFeePayerShortfall(new Error('Blockhash not found'))).toBe(false);
  });

  it('mails the team once while low, and again after a refusal', async () => {
    const { service, mailer } = setup(1_812_050n);
    await service.check();
    await service.check();
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mail = mailer.send.mock.calls[0][0];
    expect(mail.to).toBe('team@example.com');
    expect(mail.subject).toContain('0.0018 SOL');
    await service.onShortfall();
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('stays quiet above the floor, which can be configured', async () => {
    const { service, mailer } = setup(60_000_000n);
    await service.check();
    expect(mailer.send).not.toHaveBeenCalled();
    const strict = setup(60_000_000n, { FEE_PAYER_MIN_SOL: '0.1' });
    await strict.service.check();
    expect(strict.mailer.send).toHaveBeenCalledTimes(1);
  });

  it('prefers the ops address when one is set', async () => {
    const { service, mailer } = setup(0n, {
      OPS_ALERT_EMAIL: 'ops@example.com',
    });
    await service.check();
    expect(mailer.send.mock.calls[0][0].to).toBe('ops@example.com');
  });
});
