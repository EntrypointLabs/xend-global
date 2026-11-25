/** APY is an effective annual decimal rate, not an APR or percentage. */
export function projectedValue(
  principal: number,
  apy: number,
  years: number
): number {
  if (
    ![principal, apy, years].every(Number.isFinite) ||
    principal < 0 ||
    apy < 0 ||
    years < 0 ||
    years > 30
  ) {
    throw new Error("Invalid projection inputs");
  }
  const value = principal * Math.pow(1 + apy, years);
  if (!Number.isFinite(value)) throw new Error("Projection overflow");
  return value;
}

export function formatEarnMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
