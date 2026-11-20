import { toLocal } from "@/lib/phone";

/**
 * Sends one SMS through 019 (https://docs.019sms.co.il). Credentials come from
 * the environment and never leave the server:
 *   SMS019_USERNAME  the account username from the registration email
 *   SMS019_TOKEN     an API token (019 settings -> API token management)
 *   SMS019_SOURCE    the sender shown on the phone, up to 11 letters or digits
 */
const ENDPOINT = "https://019sms.co.il/api";

export class SmsError extends Error {
  constructor(
    message: string,
    /** 019's own status code, when it gave one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

// A value pasted into a dashboard often brings a space or a line break along;
// 019 compares the username and token exactly, so trim them.
const env = (name: string) => process.env[name]?.trim() || undefined;

const config = () => {
  const username = env("SMS019_USERNAME");
  const token = env("SMS019_TOKEN");
  const source = env("SMS019_SOURCE");
  return username && token && source ? { username, token, source } : null;
};

export const smsConfigured = () => config() !== null;

/**
 * Refusals only the owner of the account can fix (credit, credentials, sender
 * name, IP rule). Everything else (a busy gateway, a timeout) passes by itself.
 */
export const needsOperator = (error: unknown): boolean =>
  error instanceof SmsError && error.status !== undefined && [3, 4, 5, 10, 11, 12, 50, 503, 504, 515, 992].includes(error.status);

/** What 019 reports for the failures worth telling an operator about. */
const reasons: Record<number, string> = {
  3: "username or token rejected",
  4: "out of credit",
  5: "sending is not allowed at this time",
  10: "token expired",
  11: "token does not belong to this username",
  12: "out of credit",
  50: "this server's IP is not allowed (turn off the IP restriction in 019 settings)",
  429: "too many requests per second",
  503: "username does not exist",
  504: "token not found",
  515: "sender name is not verified with 019",
  989: "message too long or too short",
  992: "sender name is too long or too short",
};

/**
 * Supabase gives a hook five seconds in all, retries included, and answers the
 * person with an error when it runs out. Staying inside that means a text is
 * either sent while they are still waiting or not sent at all, never both
 * (a message that arrives after "sending failed" is the confusing case).
 */
const BUDGET_MS = 4200;
/** 019 allows few requests a second; one retry covers a burst. */
const RETRY_AFTER_MS = 600;

type SendOptions = { retryAfterMs?: number; budgetMs?: number };

/** `to` is an Israeli mobile number in E.164. Resolves with 019's shipment id. */
export const sendSms = async (
  to: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
  { retryAfterMs = RETRY_AFTER_MS, budgetMs = BUDGET_MS }: SendOptions = {},
): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  try {
    return await attempt(to, message, fetchImpl, deadline);
  } catch (error) {
    // "Too many requests per second" is the one refusal that a moment fixes.
    if (error instanceof SmsError && error.status === 429 && deadline - Date.now() > retryAfterMs + 1000) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      return attempt(to, message, fetchImpl, deadline);
    }
    throw error;
  }
};

const attempt = async (to: string, message: string, fetchImpl: typeof fetch, deadline: number): Promise<string> => {
  const settings = config();
  if (!settings) throw new SmsError("SMS is not configured");

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.token}` },
      body: JSON.stringify({
        sms: {
          user: { username: settings.username },
          source: settings.source,
          destinations: { phone: { _: toLocal(to), $: { id: "" } } },
          message,
        },
      }),
      signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())),
    });
  } catch (error) {
    // A timeout or a dropped connection: nothing was confirmed, so nothing is claimed.
    throw new SmsError(`019 did not answer (${error instanceof Error ? error.name : "unknown"})`);
  }

  let result: { status?: number; message?: string; shipment_id?: string } = {};
  try {
    result = await response.json();
  } catch {
    // handled below: no usable body is a failure
  }
  // Never put the number or the text (it holds a sign-in code) in an error.
  if (!response.ok || result.status !== 0) {
    const status = typeof result.status === "number" ? result.status : undefined;
    throw new SmsError(
      `019 refused the message (${status ?? `HTTP ${response.status}`}): ${(status !== undefined && reasons[status]) || result.message || "no reason given"}`,
      status,
    );
  }
  return result.shipment_id ?? "";
};
