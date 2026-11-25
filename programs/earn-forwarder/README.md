# Shared Earn forwarder

This is one shared, stateless program, with a derived authority for each existing Account. It adds no signer or permission to the Account. Its staging token accounts are ordinary token accounts created automatically by the sponsor, not new multisig accounts.

The existing two-signature Token policy grants an exact allowance to this program's authority. In the same outer transaction the forwarder transfers that input into its staging account, invokes one pinned lending instruction, checks the actual output against the signed minimum, returns the entire output and unspent input to the original Account, then the Account revokes the allowance. Failure rolls back all of it. Neither the primary signer alone nor the sponsor can access a position afterward: receipt tokens belong to the Account.

Only native Solana USDC and legacy SPL Token receipt tokens are supported. Borrowing, leverage, Token-2022, NAVI and bridges are outside this implementation. The app and backend pin Kamino's active, non-term main-market USDC reserve and Jupiter Lend's main-market USDC lending token. The on-chain program pins the two provider program IDs and the deposit/redeem ABI, validates token ownership/mints and PDA authority, refuses a vault signature passed to a provider, and enforces a positive minimum output.

## Validation

Use Rust stable and `cargo-build-sbf` 4.6.0 / platform-tools v1.58, building with the v0 architecture for compatibility with the deployed Squads test runtime:

```sh
cargo test --manifest-path programs/earn-forwarder/Cargo.toml
cargo build-sbf --arch v0 --manifest-path programs/earn-forwarder/Cargo.toml --sbf-out-dir programs/earn-forwarder/target/deploy
npm run build --workspace=@prydd/smart-account
# HELIUS_RPC_URL should be supplied privately in the execution environment.
node node_modules/tsx/dist/cli.mjs packages/smart-account/test/fixtures/fetch-earn.mts
# Fetch the existing Squads fixtures using test/fixtures/fetch-program.mjs too.
npm run test --workspace=@prydd/smart-account
```

The integration suite runs the actual downloaded Kamino, Jupiter lending/liquidity and Squads bytecode with the compiled forwarder in LiteSVM. It verifies deposit/redemption with an independent sponsor, existing two-signature policy, unchanged time-locked Settings, transaction size under 1232 bytes using a static shared lookup table, revocation after success and rollback on failure. It never broadcasts a real financial transaction. Missing fixtures are explicitly skipped; a passing skipped suite is not deployment verification.

## Production activation requires operator review

1. Review this new contract and its tests before accepting funds. Local tests are not an independent security audit. Choose an operator-controlled deployment/upgrade authority; no Consumer signing key is needed. Do not use a generated build/test keypair as a production authority.
2. Deploy the reviewed `.so` once using the operator's normal Solana deployment process. This has an operator-paid rent/network cost. Do not weaken Consumer settings or their 24-hour lock. Do not make the program immutable until its review and upgrade policy have been explicitly decided.
3. Build the smart-account package and run the lookup helper in its default **read-only** planning mode. Supply `EARN_FORWARDER_PROGRAM` and `HELIUS_RPC_URL` through the operator environment, and `--binary programs/earn-forwarder/target/deploy/prydd_earn_forwarder.so`. It prints the public canonical code hash, static market accounts and lookup rent estimate. No user-specific lookup table is required.
4. After approval, rerun with `--execute --payer-keypair /secure/operator-keypair.json` to create the shared lookup table. This script will refuse a deployed program whose code differs from the reviewed binary. It prints only public setup values, never keys.
5. Apply migration `0069_earn_operations.sql` through the normal backend migration process. Configure backend `EARN_FORWARDER_PROGRAM`, `EARN_LOOKUP_TABLE`, `EARN_FORWARDER_CODE_SHA256`. Set mobile `EXPO_PUBLIC_EARN_FORWARDER_PROGRAM` and `EXPO_PUBLIC_EARN_FORWARDER_CODE_SHA256` to the same public address/hash and distribute the normal app update. Both sides verify the code before enabling/signing. Missing deployment/configuration fails closed.
6. Confirm sponsor SOL is funded, API/Redis/DB/RPC access is healthy and `EARN_DEPOSITS_KILLSWITCH` is false. The feature flag alone cannot enable an undeployed program. After operator-approved deployment, use an explicitly approved small deposit **and withdrawal** from an existing test Account before general rollout.

There are no new Kamino or Jupiter API keys required. Read data and Jupiter rate data use the existing RPC connection; Kamino's public rate endpoint is optional and a rate outage does not fabricate a yield or erase a position.

### Existing cloud signer policies

The optional Turnkey deny policy can refuse a newly introduced top-level program independently of Squads. Accounts enrolled without those policies take the normal existing Face ID path immediately. Accounts with recorded cloud policies are deliberately unavailable until their policy compatibility is reviewed. Nothing bypasses Turnkey or silently rewrites its policy. This is not a Solana 24-hour wait, but those accounts need a separate explicit cloud-policy update path before activation. The local inventory inspected during development had three enrolled signers, none with cloud policies; that is not a production inventory assertion.

### Accounting and recovery

The backend pins quote ownership and immutable message bytes, verifies both Account signatures, saves the fully sponsored wire before broadcasting, and records it durably before broadcast. A retry sends identical bytes and therefore the same network signature. It never prepares a second deposit automatically after an ambiguous result. Signed pending approvals are retained on the phone per Account for recovery.

Positions are read from vault-owned receipt token accounts. Confirmed receipt/cash deltas populate the Earn ledger and prevent unknown/unconfirmed transactions being counted as income. Externally received shares have unknown cost basis and display unavailable earned income. Seven-day income is unavailable once a position predates the observed seven-day window; a historical valuation/snapshot is needed rather than mislabeling lifetime income. Generic Activity may still show the underlying token movement; the Earn ledger is authoritative for Earn income.

Staging accounts remain empty after success, aside from a third-party donation between transactions; a subsequent successful move returns their entire output and unused input to the same vault. The sponsor pays their one-time rent. A program upgrade changes the checked code hash and blocks new approvals until a reviewed app/backend configuration update.

## Official integration references

- [Kamino lending program and SDK](https://github.com/Kamino-Finance/klend-sdk): pinned reserve collateral instructions and reserve account layout.
- [Jupiter Lend 0.4.0 Earn SDK](https://github.com/jup-ag/jupiter-lend/blob/main/docs/earn/sdk.md): CPI account contexts, receipt tokens and APY units. The displayed supply APY excludes separate rewards.
- [Jupiter program addresses](https://developers.jup.ag/docs/lend/program-addresses): main-market programs.

Both routes stay on Solana and use native USDC; no bridge is needed. Protocol upgrades, smart-contract defects, USDC depegging/freezing and market liquidity can affect valuation or withdrawal availability. Projection curves assume an unchanged APY and are estimates. NAVI is deferred by request: it would require an explicitly designed Sui custody/recovery account, Sui gas and a reviewed native-USDC bridge route before deposits could be enabled.
