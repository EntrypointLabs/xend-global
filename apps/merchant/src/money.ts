export function formatUsdc(raw: string | bigint, { suffix = false } = {}) {
  const value = BigInt(raw);
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${value < 0n ? "-" : ""}${absolute / 1000000n}.${fraction}${suffix ? " USDC" : ""}`;
}
