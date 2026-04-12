/**
 * Character set for invite codes.
 * Uppercase alphanumeric excluding visually ambiguous characters: O, 0, I, 1, L.
 */
export const INVITE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generates an 8-character alphanumeric invite code.
 * Uses crypto.getRandomValues for cryptographic randomness.
 * Each character is drawn from INVITE_CODE_CHARS (31 characters).
 */
export function generateInviteCode(): string {
  const length = 8;
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  let code = '';
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_CHARS[randomValues[i] % INVITE_CODE_CHARS.length];
  }
  return code;
}
