/**
 * Numbers the legs of one transaction that are indistinguishable from each
 * other: same mint, same pair of addresses, same amount. Everything else is
 * already told apart by those columns, so the vast majority of legs are 0.
 */
export class LegCounter {
  private readonly seen = new Map<string, number>();

  next(mint: string, from: string, to: string, amountRaw: bigint): number {
    const key = `${mint}|${from}|${to}|${amountRaw}`;
    const index = this.seen.get(key) ?? 0;
    this.seen.set(key, index + 1);
    return index;
  }
}
