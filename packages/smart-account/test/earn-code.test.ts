import { describe, expect, it } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readEarnForwarderCode } from "../src/earn-code.js";
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
describe("reviewed forwarding program code", () => {
  it("requires an executable upgradeable program and trims only its reserved padding", async () => {
    const programData = new PublicKey(new Uint8Array(32).fill(2));
    const program = Buffer.alloc(36);
    program[0] = 2;
    programData.toBuffer().copy(program, 4);
    const bytes = Buffer.alloc(60);
    bytes[0] = 3;
    bytes.set([1, 2, 3, 0, 4], 45);
    let called = 0;
    const rpc = {
      getAccountInfo: () =>
        Promise.resolve(
          called++ === 0
            ? { executable: true, owner: loader, data: program }
            : { owner: loader, data: bytes },
        ),
    } as unknown as Connection;
    expect(
      await readEarnForwarderCode(
        rpc,
        new PublicKey(new Uint8Array(32).fill(1)),
      ),
    ).toEqual(Buffer.from([1, 2, 3, 0, 4]));
    await expect(
      readEarnForwarderCode(
        {
          getAccountInfo: () =>
            Promise.resolve({
              executable: false,
              owner: loader,
              data: program,
            }),
        } as unknown as Connection,
        programData,
      ),
    ).rejects.toThrow();
  });
});
