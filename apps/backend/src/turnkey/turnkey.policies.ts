import { PROGRAM_ID } from '@xend/smart-account';

export interface TurnkeyPolicyBody {
  policyName: string;
  effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
  consensus: string;
  condition: string;
  notes: string;
}

/**
 * The programs an S2 signature may reach. Everything a Spend or a Settings
 * change touches, and nothing else: the Squads program, System, Token,
 * Token-2022, Associated Token and ComputeBudget.
 */
export const APPROVAL_SIGNER_PROGRAM_ALLOWLIST: readonly string[] = [
  PROGRAM_ID.toBase58(),
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
];

/**
 * Policy bodies for a Consumer's S2 sub-organization, in Turnkey's Solana
 * policy language. Pure so the exact JSON is pinned by a spec: a policy is
 * only as good as its text, and the text has to be reviewable without
 * standing up Turnkey.
 *
 * The deny is the guard. An allow on its own only widens what a non-root user
 * may do; the deny is what refuses a transaction that reaches any other
 * program, whichever rule would otherwise have admitted it.
 */
export function buildApprovalSignerPolicies(
  consumerUserId: string,
): TurnkeyPolicyBody[] {
  const programs = APPROVAL_SIGNER_PROGRAM_ALLOWLIST.map(
    (key) => `'${key}'`,
  ).join(', ');
  const everyInstructionAllowed = `solana.tx.instructions.all(i, i.program_key in [${programs}])`;
  const consensus = `approvers.any(user, user.id == '${consumerUserId}')`;

  return [
    {
      policyName: 'xend-approval-allow-account-programs',
      effect: 'EFFECT_ALLOW',
      consensus,
      condition: everyInstructionAllowed,
      notes:
        'The device key may sign a Solana transaction only when every instruction targets the Squads, System, Token, Token-2022, Associated Token or ComputeBudget program.',
    },
    {
      policyName: 'xend-approval-deny-other-programs',
      effect: 'EFFECT_DENY',
      consensus: 'true',
      condition: `solana.tx.instructions.count() != solana.tx.instructions.filter(i, i.program_key in [${programs}]).count()`,
      notes:
        'Refuses any Solana transaction with an instruction outside the Account program allowlist, whoever asks.',
    },
  ];
}
