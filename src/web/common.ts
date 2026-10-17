/** Small helpers shared by the web console modules. */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_SECRET_CHARS = 400;

/**
 * Validate an optional provider key. `null` or "" means "clear it".
 * Returns the trimmed key, or null to clear.
 */
export function cleanSecret(value: unknown, prefix: string, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${label} không hợp lệ`);
  const v = value.trim();
  if (v.length > MAX_SECRET_CHARS || /\s/.test(v) || !v.startsWith(prefix)) {
    throw new HttpError(400, `${label} phải bắt đầu bằng ${prefix} và không chứa khoảng trắng`);
  }
  return v;
}

/** Validate an Ollama base URL; returns its origin, or null to clear. */
export function cleanUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new HttpError(400, "Ollama URL không hợp lệ");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "Ollama URL phải là http hoặc https");
  }
  return parsed.origin;
}
