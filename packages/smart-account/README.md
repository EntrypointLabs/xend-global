# @xend/smart-account

Owned adapter over the [Squads Smart Account Program](https://github.com/Squads-Protocol/smart-account-program). Derives Account addresses and builds unsigned transactions for the 2-of-3 signer set described in [ADR 0025](../../docs/adr/0025-account-multisig-signer-set.md).

Per ADR 0024, no vendor or protocol SDK is imported outside its owned adapter. `@sqds/smart-account` is reached only from this package.

## Why the SDK is vendored

`@sqds/smart-account` is not published to npm. It lives in a subdirectory of the program repo, which npm cannot install from a git URL. So it is built from a pinned commit, packed, and committed as a tarball under `vendor/`.

See [`vendor/README.md`](vendor/README.md) for the pin and the steps to refresh it.

## The model in one table

| Role       | Anchor             | Holder                          | Present                  |
| ---------- | ------------------ | ------------------------------- | ------------------------ |
| `primary`  | email inbox        | Privy                           | every spend              |
| `approval` | phone in hand      | Turnkey                         | above the spending limit |
| `recovery` | Apple ID or Google | encrypted blob, platform-stored | recovery only            |

Threshold 2, autonomous (no admin override), with a time lock on settings changes.

## Two things that are easy to get wrong

**The vault is the Account.** `deriveAccountAddresses` returns both a `settings` and a `vault` address. Funds live at the `vault`. The `settings` account holds the signer set and threshold and never holds money. A Consumer's receive address, QR code, and deposit destination are all the `vault`.

**The address is assigned, not derived.** The settings seed comes from a global counter in the program config, so an Account address cannot be recomputed from its signer set. Persist the seed at creation. Rotating a signer does not change the address.

## Usage

```ts
import {
  buildCreateAccount,
  fetchProgramConfig,
  nextSettingsSeed,
} from "@xend/smart-account";

const config = await fetchProgramConfig(connection);
const { instruction, addresses } = buildCreateAccount({
  signers: [
    { role: "primary", address: privyAddress },
    { role: "approval", address: turnkeyAddress },
    { role: "recovery", address: recoveryAddress },
  ],
  creator: feePayer.publicKey,
  treasury: config.treasury,
  settingsSeed: nextSettingsSeed(config),
});
```

The seed is racy: another creator can claim it between the read and the send. Treat a creation failure as a retry rather than an error.

## Tests

Unit tests cover address derivation, signer-set validation, and spend routing.

The integration suite runs the **real deployed program bytecode** in LiteSVM: Account creation, the settings time lock delaying and then releasing a change, per-policy signer sets, a one-signature spend under a limit, and the constraint that a time-locked Settings cannot carry spends at all.

It needs fixtures, which are gitignored and fetched on demand:

```sh
node test/fixtures/fetch-program.mjs   # pulls the ELF and ProgramConfig off devnet
npm test
```

Without them the integration suite **skips** rather than silently passing, so a fresh clone still runs the unit tests.
