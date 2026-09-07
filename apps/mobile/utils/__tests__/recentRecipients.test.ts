import { recentRecipientsFrom } from "@/utils/recentRecipients";

type Row = Parameters<typeof recentRecipientsFrom>[0][number];

function send(
  toAddress: string,
  createdAt: string,
  kind: Row["kind"] = "transfer"
): Row {
  return { direction: "SEND", kind, toAddress, createdAt };
}

function receive(toAddress: string, createdAt: string): Row {
  return { direction: "RECEIVE", kind: "transfer", toAddress, createdAt };
}

const NONE: ReadonlySet<string> = new Set();

describe("recentRecipientsFrom", () => {
  it("returns nothing when the Consumer has never sent", () => {
    expect(recentRecipientsFrom([], NONE, 5)).toEqual([]);
  });

  it("counts repeat sends to one address as one entry", () => {
    const rows = [
      send("alice", "2026-08-29T10:00:00.000Z"),
      send("alice", "2026-08-20T10:00:00.000Z"),
      send("alice", "2026-08-01T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 5)).toEqual([
      { address: "alice", sends: 3, lastSentAt: "2026-08-29T10:00:00.000Z" },
    ]);
  });

  it("orders by the most recent send, not by how often", () => {
    const rows = [
      send("bob", "2026-08-29T10:00:00.000Z"),
      send("alice", "2026-08-28T10:00:00.000Z"),
      send("alice", "2026-08-27T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 5).map((r) => r.address)).toEqual([
      "bob",
      "alice",
    ]);
  });

  it("takes the latest timestamp even when the feed arrives out of order", () => {
    // The chain fallback batches by signature, so newest-first is not promised.
    const rows = [
      send("alice", "2026-08-01T10:00:00.000Z"),
      send("alice", "2026-08-29T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 5)[0].lastSentAt).toBe(
      "2026-08-29T10:00:00.000Z"
    );
  });

  it("ignores money coming in", () => {
    const rows = [
      receive("someone", "2026-08-29T10:00:00.000Z"),
      send("alice", "2026-08-28T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 5).map((r) => r.address)).toEqual([
      "alice",
    ]);
  });

  it("ignores Merchant settlement addresses", () => {
    const rows = [
      send("merchant", "2026-08-29T10:00:00.000Z", "payment"),
      send("alice", "2026-08-28T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 5).map((r) => r.address)).toEqual([
      "alice",
    ]);
  });

  it("drops addresses the caller already lists elsewhere", () => {
    const rows = [
      send("saved", "2026-08-29T10:00:00.000Z"),
      send("alice", "2026-08-28T10:00:00.000Z"),
    ];

    expect(
      recentRecipientsFrom(rows, new Set(["saved"]), 5).map((r) => r.address)
    ).toEqual(["alice"]);
  });

  it("keeps the newest, not the first, when more than the limit qualify", () => {
    const rows = [
      send("c", "2026-08-27T10:00:00.000Z"),
      send("a", "2026-08-29T10:00:00.000Z"),
      send("b", "2026-08-28T10:00:00.000Z"),
    ];

    expect(recentRecipientsFrom(rows, NONE, 2).map((r) => r.address)).toEqual([
      "a",
      "b",
    ]);
  });
});
