-- Defense-in-depth against SMS-pumping and code flooding on the sign-in path.
--
-- Supabase Auth makes and rate-limits the OTP itself, but it then calls our
-- Send-SMS hook, which spends real money at 019. This gives the hook its own
-- budget so a misconfigured provider limit (or none) cannot be turned into
-- cost, or into a flood of texts aimed at one victim's number.
--
-- Only hashed identifiers are stored -- never a phone number, e-mail or IP in
-- the clear (the web server peppers them before they arrive). The table is the
-- server's alone; no app role may read or write it.

CREATE TABLE public.otp_sends (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier_hash text NOT NULL,   -- HMAC(pepper, "<channel>:<e164 or email>")
  ip_hash         text,            -- HMAC(pepper, client IP), when known
  channel         text NOT NULL,   -- 'sms' | 'email'
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_sends_identifier ON public.otp_sends (identifier_hash, created_at DESC);
CREATE INDEX otp_sends_ip ON public.otp_sends (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

ALTER TABLE public.otp_sends ENABLE ROW LEVEL SECURITY;
-- Supabase grants new tables to the API roles by default; this table is the
-- server's alone, reached only through reserve_otp_send().
REVOKE ALL ON public.otp_sends FROM PUBLIC, anon, authenticated;

-- True (and records the send) when a code request for this identifier is within
-- budget; false when it is over it. Budgets, per hashed number/e-mail:
--   at most 1 in 30s, 5 in an hour, 10 in a day;
-- and, per source IP across all identifiers: at most 20 in an hour.
-- SECURITY DEFINER with an empty search_path; called by the server (which
-- connects privileged), never by anon/authenticated.
CREATE FUNCTION public.reserve_otp_send(
  p_identifier_hash text,
  p_ip_hash         text DEFAULT NULL,
  p_channel         text DEFAULT 'sms'
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_identifier_hash IS NULL OR length(p_identifier_hash) = 0 THEN RETURN false; END IF;
  -- Two requests for the same identifier at once must not both pass.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_identifier_hash, 0));

  IF (SELECT count(*) FROM public.otp_sends
        WHERE identifier_hash = p_identifier_hash AND created_at > now() - interval '30 seconds') >= 1
     OR (SELECT count(*) FROM public.otp_sends
        WHERE identifier_hash = p_identifier_hash AND created_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.otp_sends
        WHERE identifier_hash = p_identifier_hash AND created_at > now() - interval '1 day') >= 10
  THEN
    RETURN false;
  END IF;

  IF p_ip_hash IS NOT NULL
     AND (SELECT count(*) FROM public.otp_sends
            WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour') >= 20
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.otp_sends (identifier_hash, ip_hash, channel)
       VALUES (p_identifier_hash, p_ip_hash, p_channel);
  DELETE FROM public.otp_sends WHERE created_at < now() - interval '2 days';
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.reserve_otp_send(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_otp_send(text, text, text) TO service_role;

-- Give back an allowance when the thing it was reserved for did not happen --
-- e.g. 019 refused the shopping-list text after reserve_sms_send() counted it.
-- Removes the caller's most recent send so a provider failure costs them
-- nothing. Only the signed-in person, only their own row.
CREATE FUNCTION public.release_sms_send()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  DELETE FROM public.sms_sends
   WHERE id = (SELECT id FROM public.sms_sends
                WHERE user_id = me ORDER BY sent_at DESC, id DESC LIMIT 1);
END
$$;

REVOKE ALL ON FUNCTION public.release_sms_send() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_sms_send() TO authenticated;
