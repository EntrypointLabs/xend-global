import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import type { SpendService } from '../account/spend.service';
import type { SettlementProvisioningService } from './settlement-provisioning.service';
import type { SettlementConfirmationService } from './settlement-confirmation.service';
import { SettlementService } from './settlement.service';

function harness() {
  const consumer = Keypair.generate();
  const payer = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: consumer.publicKey,
          toPubkey: payer.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  const query = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([
      {
        messageBase64: Buffer.from(tx.message.serialize()).toString('base64'),
      },
    ]),
  };
  const service = new SettlementService(
    { client: { select: () => query } } as unknown as DbService,
    {} as ConfigService,
    {} as SolanaRpc,
    {} as PaymentIntentService,
    {} as SettlementProvisioningService,
    {} as SpendService,
    {} as SettlementConfirmationService,
  );
  return { service, tx, consumer, query };
}

it('accepts the original Consumer-signed message without requiring a fee payer signature', async () => {
  const { service, tx, consumer } = harness();
  tx.sign([consumer]);
  await expect(
    service.verifySettlementProof(
      'intent',
      Buffer.from(tx.serialize()).toString('base64'),
    ),
  ).resolves.toBeUndefined();
});

it('rejects matching unsigned bytes, so knowing the reference and message is insufficient', async () => {
  const { service, tx } = harness();
  await expect(
    service.verifySettlementProof(
      'intent',
      Buffer.from(tx.serialize()).toString('base64'),
    ),
  ).rejects.toMatchObject({ code: 'SETTLEMENT_MESSAGE_MISMATCH' });
});

it('rejects a valid Consumer signature for another message', async () => {
  const { service, tx, consumer, query } = harness();
  tx.sign([consumer]);
  query.limit.mockResolvedValue([{ messageBase64: 'other-message' }]);
  await expect(
    service.verifySettlementProof(
      'intent',
      Buffer.from(tx.serialize()).toString('base64'),
    ),
  ).rejects.toMatchObject({ code: 'SETTLEMENT_MESSAGE_MISMATCH' });
});
