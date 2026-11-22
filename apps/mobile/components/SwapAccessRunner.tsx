import { useFinishSwapAccess } from "@/hooks/useSwapAccess";

/**
 * Finishes turning Swap on once its security delay has run out, the same way
 * the Spending Limit runner finishes a new limit: the last step is signed by
 * the key on this phone, so without this it waits on nobody.
 */
export function SwapAccessRunner() {
  useFinishSwapAccess();
  return null;
}
