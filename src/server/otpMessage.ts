/**
 * The text that carries a sign-in code.
 *
 * - The code comes first, so it is readable in the notification.
 * - "Do not share" is the one line that stops the usual phone scam, where
 *   someone calls and asks for "the code that was just sent".
 * - When OTP_SMS_DOMAIN is set (the host people sign in on, e.g. `app.example.com`),
 *   the last line is `@host #code`. Chrome on Android then fills the code in by
 *   itself (WebOTP) and Safari on iPhone suggests it above the keyboard, and
 *   neither will offer it to a look-alike site. It costs a second SMS segment,
 *   so it is opt-in.
 */
const hostOf = (value: string | undefined): string | null => {
  const host = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/:?#].*$/, "");
  return host && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes(".") ? host : null;
};

export const otpMessage = (code: string, domain: string | undefined = process.env.OTP_SMS_DOMAIN): string => {
  const lines = [`קוד הכניסה ל־scan home: ${code}`, "לא משתפים אותו עם אף אחד."];
  const host = hostOf(domain);
  if (host) lines.push(`@${host} #${code}`);
  return lines.join("\n");
};
