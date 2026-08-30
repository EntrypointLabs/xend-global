export {
  assertSignerSet,
  buildCreateAccount,
  InvalidSignerSetError,
  type CreateAccountParams,
  type CreateAccountResult,
} from "./account.js";

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
  buildRotateApprovalSigner,
  buildRotateRecoverySigner,
  buildSetTimeLock,
  type AddRecoverySignerParams,
  type CreateAboveLimitPolicyParams,
  type CreateSpendingLimitPolicyParams,
  type CreateSpendingLimitPolicyResult,
  type LimitPeriod,
  type ProvisionAccountParams,
  type ProvisionAccountResult,
  type RemoveRecoverySignerParams,
  type RotateApprovalSignerParams,
  type RotateApprovalSignerResult,
  type RotateRecoverySignerParams,
  type SetTimeLockParams,
  type SpendingLimitTerms,
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
  type ProposalState,
  type ProposalStatusName,
  type SettingsState,
} from "./state.js";

export { PROGRAM_ID } from "@sqds/smart-account";
