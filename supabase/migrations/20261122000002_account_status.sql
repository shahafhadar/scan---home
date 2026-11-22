-- Account state. A valid sign-in code proves someone can receive a text or an
-- e-mail; it must never, on its own, grant access to a suspended, disabled or
-- deleted account. This adds a status to every user and enforces it at the
-- database, not only in the app.

CREATE TYPE public.account_status AS ENUM ('active', 'suspended', 'disabled', 'deleted');

CREATE TABLE public.profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status     public.account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- A person may read only their own profile. Nobody changes status through the
-- API: that is an operator action (set_account_status, service role only).
CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- Existing users predate this table; they are all active.
INSERT INTO public.profiles (user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

-- Give every new account a profile alongside its household and list. This
-- replaces the function from the init migration, adding only the profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
BEGIN
  INSERT INTO public.households (name) VALUES ('הבית שלי') RETURNING id INTO household;
  INSERT INTO public.household_members (household_id, user_id, role) VALUES (household, NEW.id, 'owner');
  INSERT INTO public.lists (household_id, name, is_active) VALUES (household, 'רשימת קניות', true);
  INSERT INTO public.profiles (user_id) VALUES (NEW.id);
  RETURN NEW;
END
$$;

-- The one choke point for all household data. Every household-scoped policy
-- reads through it, so returning nothing for a non-active account cuts that
-- account off from every table at once -- lists, items, devices, scans and the
-- rest -- no matter what the app layer does.
CREATE OR REPLACE FUNCTION public.my_household_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.household_id
    FROM public.household_members m
   WHERE m.user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
$$;

-- Is the signed-in person's account active? For the app's own gate; missing
-- profile counts as not active (fail closed).
CREATE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT status = 'active' FROM public.profiles WHERE user_id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, anon;

-- Change an account's status. Operator action: the service role only (run from
-- the Supabase dashboard or a trusted server), never anon or a signed-in user.
CREATE FUNCTION public.set_account_status(p_user_id uuid, p_status public.account_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, status) VALUES (p_user_id, p_status)
  ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
END
$$;
REVOKE ALL ON FUNCTION public.set_account_status(uuid, public.account_status) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_status(uuid, public.account_status) TO service_role;
