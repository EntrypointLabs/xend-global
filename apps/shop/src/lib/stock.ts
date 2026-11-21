import type { Product } from "./catalog";
import { skuFor } from "./catalog";

export function productStock(
  product: Product,
  levels: Record<string, number>,
): number {
  return product.sizes
    ? product.sizes.reduce(
        (n, s) => n + (levels[skuFor(product.id, s)] ?? 0),
        0,
      )
    : (levels[skuFor(product.id, null)] ?? 0);
}
