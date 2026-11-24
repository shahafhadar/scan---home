-- Texts the app sends on someone's behalf (today: the shopping list, to their
-- own phone) cost real money, so each person gets a small allowance. The web
-- server asks reserve_sms_send() before it sends; people cannot read or write
-- the table themselves.

CREATE TABLE public.sms_sends (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_sends_recent ON public.sms_sends (user_id, sent_at DESC);

ALTER TABLE public.sms_sends ENABLE ROW LEVEL SECURITY;
-- No policies, and Supabase grants new tables to everyone by default: take it back.
REVOKE ALL ON public.sms_sends FROM PUBLIC, anon, authenticated;

-- True and records a send when the signed-in person is under their allowance:
-- 5 an hour and 20 a day. False when they are over it (or not signed in).
CREATE FUNCTION public.reserve_sms_send()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN false; END IF;
  -- Two taps at once must not both squeeze in under the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(me::text, 0));

  IF (SELECT count(*) FROM public.sms_sends WHERE user_id = me AND sent_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.sms_sends WHERE user_id = me AND sent_at > now() - interval '1 day') >= 20
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.sms_sends (user_id) VALUES (me);
  DELETE FROM public.sms_sends WHERE user_id = me AND sent_at < now() - interval '30 days';
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.reserve_sms_send() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_sms_send() TO authenticated;
