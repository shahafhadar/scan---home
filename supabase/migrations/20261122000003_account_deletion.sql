-- Self-service account deletion (soft). A signed-in person can close their own
-- account: it is marked 'deleted', which cuts it off everywhere at once, since
-- my_household_ids() already excludes every non-active account. The rows stay,
-- so an operator can restore (set_account_status 'active') or hard-purge later;
-- a person can never un-delete themselves just by signing in again.

CREATE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  UPDATE public.profiles SET status = 'deleted', updated_at = now() WHERE user_id = me;
END
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
