# 0042: Earn lends USDT, USDG and SOL on Jupiter, not just USDC

**Status:** Accepted
**Date:** 2026-11-26
**Deciders:** Product owner and implementation review
**Tags:** earn, solana, backend, mobile

## Context and Problem Statement

Earn launched USDC-only ([0041](./0041-earn-with-existing-account-allowances.md)). The shared forwarder pinned the USDC mint and the classic Token program, and the SDK, backend ledger and app all assumed one six-decimal dollar asset. Jupiter Lend's main market also lends USDT, USDG (a Token-2022 mint) and SOL, among others, and the product owner chose those four as the supported set.

## Decision Drivers

- No Account permission change and no Settings time lock. The above-limit policy admits System, Token and Token-2022 by program alone, so wrapping SOL and approving a Token-2022 allowance already pass it.
- The phone keeps rebuilding every message byte from its own pinned market accounts.
- One forwarder upgrade, not one per asset.

## Considered Options

1. **An on-chain asset allowlist** in the forwarder: every new asset is another upgrade.
2. **Any Jupiter main-market asset on chain, pinned markets in the SDK**: Jupiter derives each lending account and receipt mint from the asset mint, and the forwarder still checks the asset and receipt slots, vault-owned destinations, staging ownership and the signed output floor.

## Decision Outcome

Chosen option: **2**, because the phone already refuses any market it did not build from its own catalog, so an on-chain list adds an upgrade per asset without adding protection.

- The forwarder accepts Token or Token-2022, reads both account layouts by their shared prefix, and builds `TransferChecked` for whichever program the asset uses. Kamino stays pinned to USDC. The instruction format is unchanged.
- Native SOL is wrapped from the vault's lamports into its wrapped-SOL account inside the same policy call as the allowance. After the move that account is closed back to plain SOL, and the vault repays the sponsor the account rent in the same call.
- Every Earn row carries the asset's mint. Positions, deposits, withdrawals and income are kept in that asset's own base units. Dollar values are derived at read time from the price service, except `earn_operations.usd_value`, which is frozen at confirmation like a transfer's value.
- `EARN_ENABLED_ASSETS` gates new moves per asset, so USDC keeps working before the upgraded forwarder is deployed and the others turn on after it.

### Consequences

- ✅ USDT, USDG and SOL holders can lend without converting to USDC, with the same Face ID approval and no new permission.
- ✅ Another Jupiter main-market asset later needs SDK catalog data and a lookup-table extension, not a program upgrade.
- ⚠️ USDG carries issuer controls (permanent delegate, a fee and transfer-hook configuration that is currently off). If the issuer turns on a fee, the signed minimum output still protects the Consumer; a transfer hook would make moves fail without moving funds.
- ⚠️ SOL income is in SOL. Its dollar value moves with the SOL price, so dollar totals across assets are a point-in-time valuation.
- ⚠️ The upgrade changes the forwarder code hash, so app builds that pin the old hash stop signing Earn until the reviewed release ships.

## More Information

- [Forwarder review, upgrade and activation steps](../../programs/earn-forwarder/README.md)
- [Pinned Jupiter markets](../../packages/smart-account/src/earn.ts)
