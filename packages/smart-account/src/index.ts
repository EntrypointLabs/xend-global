export {
  assertSignerSet,
  buildCreateAccount,
  InvalidSignerSetError,
  ROLE_PERMISSIONS,
  type CreateAccountParams,
  type CreateAccountResult,
} from "./account.js";

export {
  deriveVaultAddress,
  describeTransaction,
  type DescribeContext,
  type DescribedSpendRoute,
  type PolicyTerms,
  type SettingsChangeAction,
  type SettingsChangeDescription,
  type SpendDescription,
  type TransactionDescription,
  type TransferDescription,
  type UnknownDescription,
  type Vote,
  type VoteDescription,
} from "./describe.js";

export {
  deriveAccountAddresses,
  derivePolicyAddress,
  fetchProgramConfig,
  nextSettingsSeed,
  type ProgramConfig,
} from "./pda.js";

export {
  buildAddRecoverySigner,
  buildApproveSettingsChange,
  buildCreateAboveLimitPolicy,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
  buildProvisionAccount,
  buildRejectSettingsChange,
  buildRemoveRecoverySigner,
  buildRemoveSpendingLimit,
  buildRotateApprovalSigner,
  buildRotatePrimarySigner,
  buildRotateRecoverySigner,
  buildSetTimeLock,
  buildUpdateSpendingLimit,
  SettingsChangeRefusedError,
  type AddRecoverySignerParams,
  type CreateAboveLimitPolicyParams,
  type CreateSpendingLimitPolicyParams,
  type CreateSpendingLimitPolicyResult,
  type LimitPeriod,
  type ProvisionAccountParams,
  type ProvisionAccountResult,
  type RemoveRecoverySignerParams,
  type RemoveSpendingLimitParams,
  type RotateApprovalSignerParams,
  type RotateApprovalSignerResult,
  type RotateRecoverySignerParams,
  type SetTimeLockParams,
  type SpendingLimitChangeResult,
  type SpendingLimitTerms,
  type UpdateSpendingLimitParams,
} from "./policy.js";

export {
  associatedTokenAddress,
  buildSpend,
  resolveSpendRoute,
  type BuildSpendParams,
  type SpendingLimit,
  type SpendRequest,
  type SpendRoute,
  type TwoSignatureReason,
} from "./spend.js";

export {
  ACCOUNT_THRESHOLD,
  SETTINGS_TIME_LOCK_SECONDS,
  type AccountAddresses,
  type AccountSigner,
  type SignerRole,
  type SignerSet,
} from "./types.js";

export {
  AccountStateError,
  decodeProposal,
  decodeSpendingLimit,
  deriveProposalAddress,
  fetchSettings,
  fetchSpendingLimit,
  nextPolicySeed,
  type ProposalState,
  type ProposalStatusName,
  type SettingsSigner,
  type SettingsState,
} from "./state.js";

export {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./programs.js";

export { PROGRAM_ID } from "@sqds/smart-account";
