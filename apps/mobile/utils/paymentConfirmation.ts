/** A signature acknowledges submission; only settlement proves payment. */
export async function waitForPaymentOutcome(
  readStatus: () => Promise<string>,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 1000)),
  attempts = 30
): Promise<"succeeded" | "failed" | "pending"> {
  for (let i = 0; i < attempts; i++) {
    const status = await readStatus();
    if (status === "succeeded" || status === "failed") return status;
    if (i + 1 < attempts) await wait();
  }
  return "pending";
}
