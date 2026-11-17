/**
 * What went wrong when asking for, or checking, a sign-in code, in the terms the
 * screen needs. Supabase reports these as an error with a `code` and an HTTP
 * `status`; a dropped connection has neither. Keeping the mapping here means the
 * login screen and the account screen answer the same way.
 */

export type OtpProblem =
  /** The number is not an Israeli mobile. */
  | "number"
  /** A code was sent a moment ago (Supabase allows one per number every 60 seconds). */
  | "cooldown"
  /** Too many requests from this connection or for this project; waiting helps. */
  | "limited"
  /** The text could not be sent: the gateway or the hook failed. */
  | "send"
  /** No connection to the server. Nothing is lost; try again. */
  | "network"
  /** The code was wrong, or it was right but too old. Supabase does not say which. */
  | "wrong"
  /** Phone sign-in is not switched on. */
  | "unavailable"
  /** The number already belongs to another account (adding a phone to an account). */
  | "taken";

type AuthLikeError = { code?: string; status?: number; name?: string; message?: string };

/** The wait Supabase asks for in "you can only request this after 42 seconds", if it says. */
export const secondsToWait = (error: AuthLikeError): number | null => {
  const match = /after (\d+) second/i.exec(error.message ?? "");
  return match ? Number(match[1]) : null;
};

const offline = (error: AuthLikeError) =>
  error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status === undefined && !error.code);

export const classifySendError = (error: AuthLikeError): OtpProblem => {
  if (error.code === "phone_provider_disabled" || /unsupported phone provider/i.test(error.message ?? "")) return "unavailable";
  if (error.code === "phone_exists") return "taken";
  if (error.code === "over_sms_send_rate_limit") return "cooldown";
  if (error.code === "over_request_rate_limit" || error.status === 429) return "limited";
  if (offline(error)) return "network";
  return "send";
};

export const classifyVerifyError = (error: AuthLikeError): OtpProblem => {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "limited";
  if (offline(error)) return "network";
  // Wrong code, expired code and a code that was replaced by a newer one all
  // come back as otp_expired (403). From the outside they are one case.
  if (error.status !== undefined && error.status >= 500) return "send";
  return "wrong";
};

/** The sentence to show, in Hebrew, for a problem. */
export const problemText = (problem: OtpProblem, seconds?: number | null): string => {
  switch (problem) {
    case "number":
      return "המספר לא נראה תקין. נייד ישראלי, למשל 050-123-4567.";
    case "cooldown":
      return seconds ? `שלחנו קוד ממש עכשיו. אפשר לבקש חדש בעוד ${seconds} שניות.` : "שלחנו קוד ממש עכשיו. אפשר לבקש חדש בעוד דקה.";
    case "limited":
      return "נשלחו או נבדקו יותר מדי קודים. נסו שוב בעוד כמה דקות.";
    case "send":
      return "לא הצלחנו לשלוח את ההודעה. נסו שוב בעוד רגע.";
    case "network":
      return "אין חיבור לאינטרנט כרגע. הקוד שהקלדתם נשמר, אפשר לנסות שוב.";
    case "wrong":
      return "הקוד לא נכון או שפג תוקפו. אפשר לנסות שוב או לבקש קוד חדש.";
    case "unavailable":
      return "כניסה עם טלפון עוד לא פעילה במערכת הזאת.";
    case "taken":
      return "המספר הזה כבר משויך לחשבון אחר. אם הוא שלכם, אפשר להיכנס איתו ישירות במסך הכניסה.";
  }
};
