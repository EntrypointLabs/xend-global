import { AuthStorage } from "@/utils/storage/authStorage";

/**
 * Which account's approval key the device should use.
 *
 * A phone can hold more than one. The key is half of a 2-of-3 signer set, so
 * using the wrong one does not fail safe: at best the signature is refused by
 * the vendor, at worst an enrolment writes over a key that cannot be replaced,
 * because replacing a signer needs two of the three and this is one of them.
 *
 * An empty string means nobody is signed in, which resolves to the unscoped key
 * the app used before scoping existed. Nothing signs in that state, and
 * returning the legacy scope keeps a pre-migration install readable.
 */
export async function accountScope(): Promise<string> {
  const user = await AuthStorage.getUser();
  const id: unknown = user?.id;
  return typeof id === "string" ? id : "";
}
