import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { otpMessage } from "@/server/otpMessage";
import { SmsError, needsOperator, sendSms, smsConfigured } from "@/server/sms019";
import { verifyWebhook } from "@/server/webhook";

/**
 * Supabase's "Send SMS" auth hook. When someone asks to sign in (or to add a
 * phone number) Supabase makes the code itself and calls this instead of its
 * own SMS provider; we only deliver the text, through 019.
 *
 * Set up in Supabase: Authentication -> Hooks -> Send SMS -> HTTPS, pointed at
 * <site>/api/auth/send-sms. Its signing secret goes in SEND_SMS_HOOK_SECRET.
 */
export const dynamic = "force-dynamic";

const payload = z.object({
  // `new_phone` is the number being added while someone verifies a phone for
  // an account that signed in another way; `phone` is the one signing in.
  user: z.object({ phone: z.string().optional(), new_phone: z.string().optional() }),
  sms: z.object({ otp: z.string().regex(/^\d{4,10}$/) }),
});

// Supabase shows the message from `error.message` to whoever asked for the code.
const refuse = (httpCode: number, message: string) => Response.json({ error: { http_code: httpCode, message } }, { status: httpCode });

export async function POST(request: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret || !smsConfigured()) return refuse(503, "SMS sign-in is not set up yet");

  const body = await request.text();
  const signed = verifyWebhook({
    secret,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body,
  });
  if (!signed) return refuse(401, "bad signature");

  let parsed: z.infer<typeof payload>;
  try {
    parsed = payload.parse(JSON.parse(body));
  } catch {
    return refuse(400, "unexpected hook payload");
  }

  // 019 is an Israeli gateway and only Israeli mobiles can sign in this way.
  const to = toE164(parsed.user.new_phone || parsed.user.phone || "");
  if (!to) return refuse(400, "רק מספרי נייד ישראליים נתמכים");

  try {
    await sendSms(to, otpMessage(parsed.sms.otp));
  } catch (error) {
    // The message names 019's status, never the number or the code. A refusal
    // only the account owner can fix (credit, credentials, sender name) gets
    // its own prefix so a log alert can tell it from a one-off timeout.
    const owner = needsOperator(error);
    console.error(`send-sms${owner ? " [needs the 019 account owner]" : ""}:`, error instanceof SmsError ? error.message : "unexpected failure");
    return owner
      ? refuse(503, "שליחת הודעות לא זמינה כרגע. אפשר להיכנס עם מייל.")
      : refuse(502, "לא הצלחנו לשלוח את ההודעה. נסו שוב בעוד רגע.");
  }
  return Response.json({});
}
