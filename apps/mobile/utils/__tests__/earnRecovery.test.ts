import { Buffer } from "buffer";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type SignatureStatus,
} from "@solana/web3.js";
import {
  readEarnApprovalOutcome,
  type PendingEarnApproval,
} from "@/utils/earnRecovery";
const response = (value: SignatureStatus | null) => ({
  context: { slot: 1 },
  value,
});
const confirmed: SignatureStatus = {
  slot: 1,
  confirmations: 1,
  err: null,
  confirmationStatus: "confirmed",
};
const signed = Buffer.from(
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: PublicKey.default,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [],
    }).compileToV0Message()
  ).serialize()
).toString("base64");
const approval: PendingEarnApproval = {
  signed,
  signature: "saved-signature",
  lastValidBlockHeight: 150,
};
function setup() {
  const rpc = {
    getSignatureStatus: jest.fn().mockResolvedValue(response(null)),
    getBlockHeight: jest.fn().mockResolvedValue(151),
    isBlockhashValid: jest
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: false }),
  };
  const read = (p = approval) =>
    readEarnApprovalOutcome(
      rpc as unknown as Pick<
        Connection,
        "getSignatureStatus" | "getBlockHeight" | "isBlockhashValid"
      >,
      p
    );
  return { rpc, read };
}
describe("persisted sponsored Earn approvals", () => {
  it("keeps a processed failure pending until a surviving block confirms the outcome", async () => {
    const h = setup();
    const err = { InstructionError: [0, { Custom: 1 }] };
    h.rpc.getSignatureStatus.mockResolvedValue(
      response({ ...confirmed, confirmationStatus: "processed", err })
    );
    await expect(h.read()).resolves.toBe("pending");
    h.rpc.getSignatureStatus.mockResolvedValue(response({ ...confirmed, err }));
    await expect(h.read()).resolves.toBe("failed");
  });
  it("does not trust an expired height while the signed blockhash is still valid", async () => {
    const h = setup();
    h.rpc.isBlockhashValid.mockResolvedValue({
      context: { slot: 1 },
      value: true,
    });
    await expect(h.read()).resolves.toBe("pending");
    expect(h.rpc.getSignatureStatus).toHaveBeenCalledTimes(1);
  });
  it("remains pending until its last valid height has passed in the finalized bank", async () => {
    const h = setup();
    h.rpc.getBlockHeight.mockResolvedValue(150);
    await expect(h.read()).resolves.toBe("pending");
    expect(h.rpc.getBlockHeight).toHaveBeenCalledWith("finalized");
    expect(h.rpc.getSignatureStatus).toHaveBeenCalledTimes(1);
  });
  it("releases an expired sponsored approval only after checking historical status again", async () => {
    const h = setup();
    await expect(h.read()).resolves.toBe("expired");
    expect(h.rpc.getSignatureStatus).toHaveBeenCalledTimes(2);
    expect(h.rpc.getSignatureStatus).toHaveBeenLastCalledWith(
      "saved-signature",
      { searchTransactionHistory: true }
    );
    expect(
      h.rpc.getSignatureStatus.mock.invocationCallOrder[1]
    ).toBeGreaterThan(h.rpc.getBlockHeight.mock.invocationCallOrder[0]);
  });
  it("recognizes a transaction that lands between the first read and finalized expiry", async () => {
    const h = setup();
    h.rpc.getSignatureStatus
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(confirmed));
    await expect(h.read()).resolves.toBe("confirmed");
  });
  it("preserves an observed but unconfirmed transaction", async () => {
    const h = setup();
    h.rpc.getSignatureStatus.mockResolvedValue(
      response({ ...confirmed, confirmationStatus: "processed" })
    );
    await expect(h.read()).resolves.toBe("pending");
    expect(h.rpc.getBlockHeight).not.toHaveBeenCalled();
  });
  it("recognizes an explicit chain failure", async () => {
    const h = setup();
    h.rpc.getSignatureStatus.mockResolvedValue(
      response({ ...confirmed, err: { InstructionError: [0, { Custom: 1 }] } })
    );
    await expect(h.read()).resolves.toBe("failed");
  });
  it("does not mistake an RPC outage for expiry", async () => {
    const h = setup();
    h.rpc.getBlockHeight.mockRejectedValue(new Error("offline"));
    await expect(h.read()).rejects.toThrow("offline");
  });
  it("keeps an unsigned or not-yet-sponsored approval pending", async () => {
    const h = setup();
    await expect(h.read({ signed })).resolves.toBe("pending");
    expect(h.rpc.getSignatureStatus).not.toHaveBeenCalled();
  });
  it("recovers old saved approvals without a stored block height", async () => {
    const h = setup();
    await expect(
      h.read({ signed, signature: "saved-signature" })
    ).resolves.toBe("expired");
    expect(h.rpc.isBlockhashValid).toHaveBeenCalledWith(
      PublicKey.default.toBase58(),
      { commitment: "confirmed" }
    );
    expect(h.rpc.isBlockhashValid).toHaveBeenCalledWith(
      PublicKey.default.toBase58(),
      { commitment: "finalized" }
    );
  });
  it("does not expire an old approval whose hash is confirmed but not yet finalized", async () => {
    const h = setup();
    h.rpc.isBlockhashValid
      .mockResolvedValueOnce({ context: { slot: 2 }, value: true })
      .mockResolvedValueOnce({ context: { slot: 1 }, value: false });
    await expect(
      h.read({ signed, signature: "saved-signature" })
    ).resolves.toBe("pending");
    expect(h.rpc.getSignatureStatus).toHaveBeenCalledTimes(1);
  });
});
