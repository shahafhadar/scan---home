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

const config = () => {
  const username = process.env.SMS019_USERNAME;
  const token = process.env.SMS019_TOKEN;
  const source = process.env.SMS019_SOURCE;
  return username && token && source ? { username, token, source } : null;
};

export const smsConfigured = () => config() !== null;

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

/** `to` is an Israeli mobile number in E.164. Resolves with 019's shipment id. */
export const sendSms = async (to: string, message: string, fetchImpl: typeof fetch = fetch): Promise<string> => {
  const settings = config();
  if (!settings) throw new SmsError("SMS is not configured");

  const response = await fetchImpl(ENDPOINT, {
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
    signal: AbortSignal.timeout(8000),
  });

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
