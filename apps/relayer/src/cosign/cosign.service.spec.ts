import { CosignService } from "./cosign.service";
import { InstructionNotAllowedError } from "./cosign.errors";
import { validateSettlementTransaction } from "./tx-validation";
import type { RelayerConfig } from "../relayer-config";
import type { FeePayerSigner } from "../signer/signer.interface";
import type { RelayerRpc } from "../rpc/relayer-rpc";
import type { CapsService } from "../caps/caps.service";
import type { CosignRequest } from "./dtos";

jest.mock("./tx-validation");
const mockValidate = validateSettlementTransaction as jest.MockedFunction<
  typeof validateSettlementTransaction
>;

const cfg = { feePayerAddress: "FEE" } as RelayerConfig;

function makeReq(intentId = "pi_1"): CosignRequest {
  return {
    intentId,
    consumerId: "c1",
    merchantId: "m1",
    transactionBase64: "dummy",
    expectedSettlementAccount: "x".repeat(40),
  };
}

function deps() {
  const signTransaction = jest.fn().mockResolvedValue("signedWire");
  const simulateTransaction = jest.fn().mockResolvedValue({ err: null });
  const sendRawTransaction = jest.fn().mockResolvedValue("SIG123");
  const checkAndReserve = jest.fn();
  const recordSpend = jest.fn();

  const signer = { address: "FEE", signTransaction } as FeePayerSigner;
  const rpc = {
    simulateTransaction,
    sendRawTransaction,
  } as unknown as RelayerRpc;
  const caps = {
    checkAndReserve,
    recordSpend,
    globalFeeLamportsToday: jest.fn().mockReturnValue(0n),
  } as unknown as CapsService;

  return {
    signer,
    rpc,
    caps,
    signTransaction,
    simulateTransaction,
    sendRawTransaction,
    recordSpend,
  };
}

beforeEach(() => {
  mockValidate.mockReset();
  mockValidate.mockReturnValue({
    amount: 1_000_000n,
    computeUnitPrice: 1000n,
    computeUnitLimit: 200_000,
    estimatedFeeLamports: 10_200n,
  });
});

describe("CosignService", () => {
  it("validates, simulates, then signs, then broadcasts, and records spend", async () => {
    const d = deps();
    const svc = new CosignService(cfg, d.signer, d.rpc, d.caps);
    const res = await svc.cosign(makeReq(), "corr-1");

    expect(res).toEqual({
      signature: "SIG123",
      status: "BROADCAST",
      correlationId: "corr-1",
    });
    const simOrder = d.simulateTransaction.mock.invocationCallOrder[0];
    const signOrder = d.signTransaction.mock.invocationCallOrder[0];
    const sendOrder = d.sendRawTransaction.mock.invocationCallOrder[0];
    expect(simOrder).toBeLessThan(signOrder);
    expect(signOrder).toBeLessThan(sendOrder);
    expect(d.recordSpend).toHaveBeenCalledWith({
      consumerId: "c1",
      feeLamports: 10_200n,
    });
  });

  it("never signs or broadcasts when validation fails", async () => {
    const d = deps();
    mockValidate.mockImplementation(() => {
      throw new InstructionNotAllowedError("nope");
    });
    const svc = new CosignService(cfg, d.signer, d.rpc, d.caps);
    await expect(svc.cosign(makeReq(), "corr-2")).rejects.toBeInstanceOf(
      InstructionNotAllowedError,
    );
    expect(d.signTransaction).not.toHaveBeenCalled();
    expect(d.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("never signs or broadcasts when simulation fails", async () => {
    const d = deps();
    d.simulateTransaction.mockResolvedValue({
      err: { InstructionError: [0, "Custom"] },
    });
    const svc = new CosignService(cfg, d.signer, d.rpc, d.caps);
    await expect(svc.cosign(makeReq(), "corr-3")).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
    });
    expect(d.signTransaction).not.toHaveBeenCalled();
    expect(d.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("serves a repeated intentId from the replay guard without re-validating, signing, or broadcasting", async () => {
    const d = deps();
    const svc = new CosignService(cfg, d.signer, d.rpc, d.caps);
    const first = await svc.cosign(makeReq("pi_dup"), "corr-4");
    const second = await svc.cosign(makeReq("pi_dup"), "corr-5");

    expect(second.signature).toBe(first.signature);
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(d.signTransaction).toHaveBeenCalledTimes(1);
    expect(d.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
