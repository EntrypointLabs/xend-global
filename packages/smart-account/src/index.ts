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
  fetchStagedSettingsChange,
  type DescribeContext,
  type DescribedSpendRoute,
  type PolicyTerms,
  type SettingsChangeAction,
  type SettingsChangeDescription,
  type SpendDescription,
  type StagedSettingsChange,
  type SwapDescription,
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
  buildUpdateAboveLimitAllowlist,
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
  type UpdateAboveLimitAllowlistParams,
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
  buildSwap,
  buildSwapOnAllowance,
  JUPITER_ROUTE_ACCOUNTS,
  minimumAmountOut,
  readJupiterRouteTerms,
  ROUTE_TERMS_UNREADABLE,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  VENUE_TAKES_VAULT_SIGNATURE,
  type BuildSwapParams,
  type JupiterRouteTerms,
} from "./swap.js";

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
  decodeAllowedPrograms,
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
  JUPITER_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "./programs.js";

export { PROGRAM_ID } from "@sqds/smart-account";

export {
  buildTokenAllowance,
  type TokenAllowanceParams,
} from "./token-allowance.js";
export {
  EARN_USDC,
  EARN_PROVIDERS,
  earnAuthority,
  earnProviderAccounts,
  buildEarnInstructions,
  type EarnProviderId,
  type EarnAction,
  type EarnTerms,
  type BuildEarnParams,
} from "./earn.js";
export {
  decodeEarnExchangeRate,
  readEarnExchangeRate,
  sharesValue,
  sharesForValue,
  depositShares,
  type EarnExchangeRate,
} from "./earn-state.js";
export { checkEarnMessage } from "./earn-verify.js";
export { readEarnForwarderCode } from "./earn-code.js";
