// Shared username validation. The same rules feed every FE submit-button
// gate and the server-side validator (see server/services/validation.py),
// so changing one of the constants below means changing both sides.
export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 50;

const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

export type NameValidation = { ok: true } | { ok: false; error: string };

export function validateUserName(name: string | null | undefined): NameValidation {
  if (name === null || name === undefined) {
    return { ok: false, error: "Please enter your name" };
  }
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH) {
    return { ok: false, error: "Please enter your name" };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` };
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { ok: false, error: "Name contains invalid characters" };
  }
  return { ok: true };
}

export function isValidUserName(name: string | null | undefined): boolean {
  return validateUserName(name).ok;
}
