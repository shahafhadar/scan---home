import { createHmac } from "node:crypto";
import { one } from "./db";

/**
 * A budget on sign-in code requests, on top of Supabase Auth's own limits, so
 * nobody can run up 019 cost or flood one number with texts (see the
 * 20261122000001_otp_abuse migration for the actual limits).
 *
 * Identifiers and IPs are hashed with a server-side pepper before they ever
 * reach the database, so no phone number, e-mail or IP is stored in the clear.
 *
 * It guards cost, not access -- Supabase still gates sign-in -- so it fails
 * open: when OTP_PEPPER is not set it is simply inactive, and a database error
 * lets the request through rather than taking sign-in down. Only a definite
 * "over budget" stops a send.
 */
const peppered = (pepper: string, value: string): string =>
  createHmac("sha256", pepper).update(value).digest("hex");

export const reserveOtpSend = async (input: {
  /** The destination in canonical form: an E.164 number or a lower-cased e-mail. */
  identifier: string;
  ip?: string | null;
  channel?: "sms" | "email";
}): Promise<boolean> => {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper) return true; // inactive until configured; Supabase still limits.

  const channel = input.channel ?? "sms";
  try {
    const row = await one<{ ok: boolean }>(`SELECT public.reserve_otp_send($1, $2, $3) AS ok`, [
      peppered(pepper, `${channel}:${input.identifier}`),
      input.ip ? peppered(pepper, input.ip) : null,
      channel,
    ]);
    return row?.ok ?? true;
  } catch (error) {
    // A cost guard must never take sign-in down: let it through, but say so.
    console.error("otp-budget:", error instanceof Error ? error.message : "unexpected failure");
    return true;
  }
};

/** The caller's IP on Vercel, from the standard proxy header. */
export const clientIp = (request: Request): string | null =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
