/**
 * Israeli mobile numbers. People type them every way there is
 * ("050-123 4567", "+972 50 123 4567", "972501234567"), and the sign-in
 * provider wants E.164. One place decides what counts as a number.
 */

/**
 * Turns Arabic-Indic (٠-٩) and Persian (۰-۹) digits into 0-9, and drops what
 * copying a number from a contact card or a chat leaves behind: direction
 * marks, non-breaking spaces and the like. Many Israelis type on an Arabic
 * keyboard, and the sign-in provider only understands 0-9.
 */
export const normalizeDigits = (input: string): string =>
  input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00a0]/g, "");

/** What someone typed into a code box, as plain digits, at most `length` of them. */
export const codeDigits = (input: string, length = 6): string => normalizeDigits(input).replace(/\D/g, "").slice(0, length);

/** E.164 (`+9725XXXXXXXX`) for an Israeli mobile number, or null if it is not one. */
export const toE164 = (input: string): string | null => {
  let digits = normalizeDigits(input).replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, "");
  // 00972 is how a number is dialled from a landline abroad.
  if (digits.startsWith("00972")) digits = digits.slice(5);
  else if (digits.startsWith("972")) digits = digits.slice(3);
  // "+972 (0)50..." and "050..." both keep the trunk zero; the number does not.
  if (digits.startsWith("0")) digits = digits.slice(1);
  // Mobile numbers are 5X followed by seven digits. Landlines cannot take an SMS.
  return /^5\d{8}$/.test(digits) ? `+972${digits}` : null;
};

/** `05XXXXXXXX`, the form Israeli SMS gateways take. */
export const toLocal = (e164: string): string => `0${e164.replace(/^\+972/, "")}`;

/** `050-123-4567` for showing a number back to its owner. */
export const formatPhone = (e164: string): string => {
  const local = toLocal(e164);
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
};
