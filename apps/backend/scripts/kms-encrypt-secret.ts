/**
 * Encrypts a raw secret under a KMS key and prints the base64 ciphertext that
 * SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT and
 * RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT expect.
 *
 * The secret is read from stdin so it never lands in shell history or `ps`.
 * Credentials and region come from the AWS SDK's standard chain (AWS_PROFILE,
 * AWS_REGION, instance role); pass --region to override.
 *
 * Usage:
 *   printf '%s' "$SECRET" | npx ts-node scripts/kms-encrypt-secret.ts --key-id <arn> [--region eu-west-1]
 */
import { EncryptCommand, KMSClient } from '@aws-sdk/client-kms';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

async function main(): Promise<void> {
  const keyId = argument('--key-id');
  if (!keyId) {
    console.error('usage: kms-encrypt-secret.ts --key-id <arn> [--region <r>]');
    process.exit(2);
  }
  const secret = await readStdin();
  if (!secret) {
    console.error('no secret on stdin');
    process.exit(2);
  }

  const region = argument('--region');
  const kms = new KMSClient(region ? { region } : {});
  const out = await kms.send(
    new EncryptCommand({
      KeyId: keyId,
      Plaintext: Buffer.from(secret, 'utf-8'),
    }),
  );
  if (!out.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no ciphertext');
  }
  process.stdout.write(Buffer.from(out.CiphertextBlob).toString('base64'));
  process.stdout.write('\n');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
