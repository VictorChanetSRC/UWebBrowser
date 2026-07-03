/** One place for the localStorage load/save scaffold every settings module
 *  repeats: parse the first present key (later keys are legacy fallbacks),
 *  validate it, and fall back on any failure. Each module supplies its own
 *  validation — this only owns the try/catch and the migration order. */

export function loadJson<T>(
  keys: string[],
  validate: (raw: unknown) => T | null,
  fallback: () => T,
): T {
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const value = validate(JSON.parse(raw));
      if (value !== null) return value;
    } catch {
      // Corrupt or unparseable — try the next key, then the fallback.
    }
  }
  return fallback();
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; nothing actionable here.
  }
}
