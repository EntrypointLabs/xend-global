/*
 * Pulls the deployed Squads program ELF and its ProgramConfig account so the
 * integration test can run the real bytecode locally in LiteSVM.
 *
 *   node test/fixtures/fetch-program.mjs
 *
 * Artifacts are gitignored. The integration test skips with a clear message when
 * they are absent, so a fresh clone still passes the unit tests.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";
import { accounts, getProgramConfigPda, PROGRAM_ID } from "@sqds/smart-account";

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";

// BPFLoaderUpgradeable ProgramData: 4-byte enum + 8-byte slot + 1-byte Option
// discriminant + 32-byte upgrade authority, then the ELF.
const PROGRAM_DATA_HEADER = 45;

const connection = new Connection(RPC, "confirmed");

const programAccount = await connection.getAccountInfo(PROGRAM_ID);
if (!programAccount) throw new Error(`program not found on ${RPC}`);

const programDataAddress = new PublicKey(programAccount.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress);
if (!programData) throw new Error("program data account not found");

const elf = programData.data.subarray(PROGRAM_DATA_HEADER);
writeFileSync(join(here, "program.so"), elf);

const [programConfigPda] = getProgramConfigPda({});
const raw = await connection.getAccountInfo(programConfigPda);
if (!raw) throw new Error("program config not found");

writeFileSync(
  join(here, "program-config.json"),
  JSON.stringify(
    {
      address: programConfigPda.toBase58(),
      owner: raw.owner.toBase58(),
      lamports: raw.lamports,
      data: raw.data.toString("base64"),
    },
    null,
    2
  )
);

const config = await accounts.ProgramConfig.fromAccountAddress(
  connection,
  programConfigPda
);

console.log(`program.so           ${elf.length} bytes`);
console.log(`treasury             ${config.treasury.toBase58()}`);
console.log(`creation fee         ${config.smartAccountCreationFee} lamports`);
console.log(`smart_account_index  ${config.smartAccountIndex}`);
