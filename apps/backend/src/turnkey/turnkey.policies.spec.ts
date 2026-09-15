import { PROGRAM_ID } from '@xend/smart-account';
import { buildApprovalSignerPolicies } from './turnkey.policies';

const PROGRAMS = `'${PROGRAM_ID.toBase58()}', '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111'`;

describe('buildApprovalSignerPolicies', () => {
  it('pins the exact policy bodies', () => {
    expect(buildApprovalSignerPolicies('user-consumer')).toEqual([
      {
        policyName: 'xend-approval-allow-account-programs',
        effect: 'EFFECT_ALLOW',
        consensus: "approvers.any(user, user.id == 'user-consumer')",
        condition: `solana.tx.instructions.all(i, i.program_key in [${PROGRAMS}])`,
        notes:
          'The device key may sign a Solana transaction only when every instruction targets the Squads, System, Token, Token-2022, Associated Token or ComputeBudget program.',
      },
      {
        policyName: 'xend-approval-deny-other-programs',
        effect: 'EFFECT_DENY',
        consensus: 'true',
        condition: `solana.tx.instructions.count() != solana.tx.instructions.filter(i, i.program_key in [${PROGRAMS}]).count()`,
        notes:
          'Refuses any Solana transaction with an instruction outside the Account program allowlist, whoever asks.',
      },
    ]);
  });

  it('names the Squads program by its deployed id', () => {
    expect(PROGRAM_ID.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(JSON.stringify(buildApprovalSignerPolicies('u'))).toContain(
      PROGRAM_ID.toBase58(),
    );
  });
});
