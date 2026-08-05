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
  buildApproveSettingsChange,
  buildCreateAboveLimitPolicy,
  buildCreateSpendingLimitPolicy,
  buildExecuteSettingsChange,
  buildRejectSettingsChange,
  type CreateAboveLimitPolicyParams,
  type CreateSpendingLimitPolicyParams,
  type CreateSpendingLimitPolicyResult,
  type LimitPeriod,
  type SpendingLimitTerms,
} from "./policy.js";

export {
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

export { PROGRAM_ID } from "@sqds/smart-account";
