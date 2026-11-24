/**
 * Everything that sends a text (sign in with a phone number, "send me the
 * list") is hidden until this is on, so the screens never offer something that
 * cannot work yet. Set once the 019 account and the Supabase hook are in place
 * (docs/sms-login.md). Inlined at build time.
 */
export const smsEnabled = process.env.NEXT_PUBLIC_SMS_LOGIN === "true";

/**
 * Cloudflare Turnstile site key (public). When set, the login forms show a
 * bot-check and pass its token to Supabase on every code request; Supabase
 * verifies it with the matching secret held in its own CAPTCHA settings. Unset
 * (the default) means no bot-check, so the screens work before it is turned on.
 * Inlined at build time.
 */
export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
