/**
 * Israeli mobile numbers. People type them every way there is
 * ("050-123 4567", "+972 50 123 4567", "972501234567"), and the sign-in
 * provider wants E.164. One place decides what counts as a number.
 */

/** E.164 (`+9725XXXXXXXX`) for an Israeli mobile number, or null if it is not one. */
export const toE164 = (input: string): string | null => {
  let digits = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("972")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
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
