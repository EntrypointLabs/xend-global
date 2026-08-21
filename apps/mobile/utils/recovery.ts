/**
 * How many recovery keys an Account may hold (D10).
 *
 * Mirrors `MAX_RECOVERY_SIGNERS` on the backend, which is the authority: this
 * copy exists so the add button can be disabled before a request rather than
 * after one comes back refused.
 */
export const MAX_RECOVERY_KEYS = 3;
