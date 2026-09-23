export function asProviderRecord<E extends Error>(
  value: unknown,
  invalid: () => E,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid();
  }
  return value as Record<string, unknown>;
}

/** Preserve JSON numeric lexemes before JSON.parse can round money values. */
export function parseExactProviderJson<E extends Error>(
  text: string,
  invalid: () => E,
): unknown {
  try {
    if (text.length > 1_000_000) throw invalid();
    return JSON.parse(
      text.replace(
        /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
      ),
    ) as unknown;
  } catch (error) {
    if (error instanceof Error && error.constructor !== SyntaxError)
      throw error;
    throw invalid();
  }
}
