# 0041: Earn through existing Account token allowances

**Status:** Accepted
**Date:** 2026-11-25
**Deciders:** Product owner and implementation review
**Tags:** earn, security, backend, mobile, solana

## Context and Problem Statement

Existing Accounts have a two-signature Token policy and a 24-hour Settings lock. Adding lending programs to that policy would make existing testers approve a permission change and wait. The swap implementation already grants exact token allowances through the existing policy, then performs the external operation in the same transaction.

Kamino redemption requires a signer-owned destination. Its actual USDC output changes with interest, so an off-chain fixed sweep cannot reliably redeem all shares and return all proceeds to the Account atomically.

## Decision Drivers

- Existing users keep their signer set and time-locked permissions.
- Every lending receipt and withdrawal belongs to the original Account.
- Face ID approves exact transaction terms under both existing signatures.
- Failed calls roll back; ambiguous broadcasts retry identical signed bytes.

## Considered Options

1. Add provider permissions to each Account: requires an existing-user Settings change and lock.
2. Use a primary-signer allowance directly: cannot safely sweep variable Kamino redemption output with the required destination ownership.
3. Use one shared forwarding program with a derived authority per Account and exact allowances.

## Decision Outcome

Implement option 3 for review. Deployment and production activation remain operator decisions. The shared program invokes only the supported deposit/redeem methods, validates staging and vault token ownership, checks a signed output floor, sweeps actual output and unused input to the vault, and uses a final outer revoke. Sponsor-created staging accounts are token accounts, not additional multisigs or signers.

The phone rebuilds every message byte, independently reads the exchange ratio and policy, verifies the reviewed executable hash, then requests the existing biometric approval signature and primary signature. The backend pins owner/message/expiry, sponsors fees and durably saves the signed wire before broadcast. A pause on deposits does not pause exits.

### Consequences

- Existing compatible Accounts need no new Solana permissions or 24-hour wait.
- One shared deployment and lookup table serve all users. No new provider API key or bridge is required.
- The forwarder introduces a contract requiring review, a deployment/upgrade authority and sponsor-paid rent. Program upgrades require a reviewed code-hash configuration update.
- Optional existing Turnkey cloud deny policies may still block the new program. Those accounts stay disabled pending explicit policy compatibility review; nothing bypasses the cloud signer.
- Historical income is unavailable without a known cash-flow basis or seven-day baseline. NAVI/Sui custody and bridging remain deferred.

## More Information

- [Forwarder review and activation steps](../../programs/earn-forwarder/README.md)
- [Swap allowance precedent](../../packages/smart-account/src/token-allowance.ts)
- [Transaction verification](../../packages/smart-account/src/earn-verify.ts)

## Deployment on 2026-11-25

The project owner funded deployment and designated the PRYDD Protocol Authority Squad. The forwarder was deployed with upgrade authority assigned to that Squad's vault in the same transaction. Its 2-of-3 threshold and on-chain ownership were verified; the fee wallet only pays operational costs. See the [mainnet deployment record](../../programs/earn-forwarder/deployments/mainnet.json). The project owner subsequently authorized launch. Backend/mobile release and a small Face ID deposit/withdrawal verification remain operational steps, without another approval or Account permission delay.
