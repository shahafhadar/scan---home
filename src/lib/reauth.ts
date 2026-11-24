/**
 * Sensitive actions -- deleting the account, and the like -- need a recent
 * sign-in, not merely a valid session: a session someone walked away from, or
 * a borrowed device, must not be enough. The authentication event counts as
 * fresh for this long after the last sign-in.
 */
export const REAUTH_MAX_AGE_MS = 10 * 60 * 1000;

/** True when the last sign-in is recent enough to allow a sensitive action. */
export const isRecentAuth = (lastSignInAt: string | null | undefined, now: number = Date.now()): boolean => {
  if (!lastSignInAt) return false;
  const at = Date.parse(lastSignInAt);
  return Number.isFinite(at) && now - at <= REAUTH_MAX_AGE_MS;
};
