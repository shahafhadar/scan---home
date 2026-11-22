import { query } from "./db";

/**
 * Records a security-relevant event to the append-only trail. Pass hashed
 * identifiers and user ids only -- never a code, a token, or a raw phone
 * number or e-mail. Logging must never break the request it describes, so a
 * failure here is swallowed (and noted on the server console).
 */
export type SecurityEvent =
  | "account_exported"
  | "account_deleted"
  | "account_delete_refused_reauth"
  | "account_status_changed";

export const recordSecurityEvent = async (
  event: SecurityEvent,
  fields: {
    userId?: string | null;
    identifierHash?: string | null;
    ipHash?: string | null;
    meta?: Record<string, unknown>;
    correlationId?: string | null;
  } = {},
): Promise<void> => {
  try {
    await query(
      `INSERT INTO public.security_events (event, user_id, identifier_hash, ip_hash, meta, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event,
        fields.userId ?? null,
        fields.identifierHash ?? null,
        fields.ipHash ?? null,
        JSON.stringify(fields.meta ?? {}),
        fields.correlationId ?? null,
      ],
    );
  } catch (error) {
    console.error("security-log:", error instanceof Error ? error.message : "unexpected failure");
  }
};
