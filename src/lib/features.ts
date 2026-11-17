/**
 * Everything that sends a text (sign in with a phone number, "send me the
 * list") is hidden until this is on, so the screens never offer something that
 * cannot work yet. Set once the 019 account and the Supabase hook are in place
 * (docs/sms-login.md). Inlined at build time.
 */
export const smsEnabled = process.env.NEXT_PUBLIC_SMS_LOGIN === "true";
