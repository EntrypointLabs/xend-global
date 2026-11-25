import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EARN_PROVIDERS } from "../src/earn.js";
import {
  decodeEarnExchangeRate,
  sharesValue,
  sharesForValue,
  depositShares,
} from "../src/earn-state.js";
const fixture = join(import.meta.dirname, "fixtures/earn/accounts.json");
describe.skipIf(!existsSync(fixture))("recorded lending exchange rates", () => {
  it.each(["kamino", "jupiter"] as const)(
    "decodes the pinned %s state and round trips within one share",
    (provider) => {
      const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
      const row = snapshot.accounts.find(
        (a: { address: string }) =>
          a.address === EARN_PROVIDERS[provider].reserve,
      );
      const data = Buffer.from(row.data, "base64"),
        price = decodeEarnExchangeRate(provider, data);
      expect(price.numerator).toBeGreaterThan(0n);
      expect(price.denominator).toBeGreaterThan(0n);
      const shares = sharesForValue(1000000n, price);
      expect(sharesValue(shares, price)).toBeGreaterThanOrEqual(999999n);
      expect(depositShares(1000000n, price)).toBeLessThanOrEqual(shares);
      const mutated = Buffer.from(data);
      mutated[0] = mutated[0]! ^ 1;
      expect(() => decodeEarnExchangeRate(provider, mutated)).toThrow();
      const wrongMint = Buffer.from(data);
      wrongMint[provider === "kamino" ? 128 : 8] =
        wrongMint[provider === "kamino" ? 128 : 8]! ^ 1;
      expect(() => decodeEarnExchangeRate(provider, wrongMint)).toThrow();
    },
  );
});
