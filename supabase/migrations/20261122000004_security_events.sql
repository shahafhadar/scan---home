-- An append-only trail of security-relevant events, for noticing abuse and
-- investigating incidents. It never holds a code, a token, or a raw phone
-- number or e-mail: identifiers are already hashed by the time they get here.
-- The table is the server's alone -- no app role may read or write it.

CREATE TABLE public.security_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  event           text NOT NULL,
  user_id         uuid,            -- when known and safe to record
  identifier_hash text,            -- hashed phone/e-mail, never the value
  ip_hash         text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  text
);
CREATE INDEX security_events_at ON public.security_events (at DESC);
CREATE INDEX security_events_event ON public.security_events (event, at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;

-- Record the operator status change in the trail too, so a suspension or
-- restoration is visible even though it happens outside the app.
CREATE OR REPLACE FUNCTION public.set_account_status(p_user_id uuid, p_status public.account_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, status) VALUES (p_user_id, p_status)
  ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('account_status_changed', p_user_id, jsonb_build_object('status', p_status));
END
$$;
