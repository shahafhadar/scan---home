-- Sharing a household (and the scanners in it) with other people, on top of the
-- member_role (owner|member|viewer) that already exists. An owner invites by
-- e-mail, the invited person accepts once signed in, and an owner can change a
-- role, remove a member, or release a device for sale. A household always keeps
-- at least one owner.

CREATE TABLE public.household_invites (
  token        text PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         public.member_role NOT NULL DEFAULT 'member',
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  used_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX household_invites_household ON public.household_invites (household_id);

ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;
-- Members can see their household's pending invites (the UI lists them); writes
-- go only through the functions below.
CREATE POLICY "members read invites" ON public.household_invites
  FOR SELECT TO authenticated USING (household_id IN (SELECT public.my_household_ids()));
REVOKE ALL ON public.household_invites FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.household_invites FROM authenticated;

-- True when the signed-in person is an owner of this household. SECURITY DEFINER
-- so it does not depend on the caller's own read access.
CREATE FUNCTION public.is_household_owner(p_household_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
     WHERE household_id = p_household_id AND user_id = auth.uid() AND role = 'owner'
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_household_owner(uuid) TO authenticated;

-- The members of a household, for the sharing screen. A member may list their
-- own household's members (and see their e-mails, since they share it); an
-- outsider gets nothing. SECURITY DEFINER to read auth.users.email.
CREATE FUNCTION public.list_household_members(p_household_id uuid)
RETURNS TABLE (user_id uuid, email text, role public.member_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id, u.email, m.role
    FROM public.household_members m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.household_id = p_household_id
     AND EXISTS (SELECT 1 FROM public.household_members me
                  WHERE me.household_id = p_household_id AND me.user_id = auth.uid())
   ORDER BY m.role, u.email
$$;
REVOKE ALL ON FUNCTION public.list_household_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_household_members(uuid) TO authenticated;

CREATE FUNCTION public.create_household_invite(p_household_id uuid, p_email text, p_role public.member_role DEFAULT 'member')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  -- An opaque, unguessable token. gen_random_uuid() is a built-in, so it works
  -- under the empty search_path (pgcrypto's gen_random_bytes would not).
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT public.is_household_owner(p_household_id) THEN
    RAISE EXCEPTION 'only an owner can invite' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'invite as member or viewer, promote to owner afterwards' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.household_invites (token, household_id, email, role, created_by, expires_at)
       VALUES (tok, p_household_id, lower(btrim(p_email)), p_role, auth.uid(), now() + interval '7 days');
  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('household_invite_created', auth.uid(), jsonb_build_object('household', p_household_id, 'role', p_role));
  RETURN tok;
END
$$;
REVOKE ALL ON FUNCTION public.create_household_invite(uuid, text, public.member_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_household_invite(uuid, text, public.member_role) TO authenticated;

-- The invited person accepts, once signed in with the e-mail it was sent to.
CREATE FUNCTION public.accept_household_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  inv        public.household_invites%ROWTYPE;
  my_email   text;
BEGIN
  SELECT email INTO my_email FROM auth.users WHERE id = auth.uid();
  SELECT * INTO inv FROM public.household_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR inv.used_at IS NOT NULL OR inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ההזמנה אינה בתוקף');
  END IF;
  IF lower(my_email) <> inv.email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ההזמנה נשלחה לכתובת אחרת');
  END IF;

  INSERT INTO public.household_members (household_id, user_id, role)
       VALUES (inv.household_id, auth.uid(), inv.role)
  ON CONFLICT (household_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.household_invites SET used_at = now(), used_by = auth.uid() WHERE token = p_token;
  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('household_invite_accepted', auth.uid(), jsonb_build_object('household', inv.household_id));
  RETURN jsonb_build_object('ok', true, 'household_id', inv.household_id);
END
$$;
REVOKE ALL ON FUNCTION public.accept_household_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_household_invite(text) TO authenticated;

CREATE FUNCTION public.revoke_household_invite(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  hh uuid;
BEGIN
  SELECT household_id INTO hh FROM public.household_invites WHERE token = p_token;
  IF hh IS NULL OR NOT public.is_household_owner(hh) THEN
    RAISE EXCEPTION 'only an owner can revoke' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.household_invites WHERE token = p_token AND used_at IS NULL;
END
$$;
REVOKE ALL ON FUNCTION public.revoke_household_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_household_invite(text) TO authenticated;

-- How many owners a household has, so the last one is never removed or demoted.
CREATE FUNCTION public.owner_count(p_household_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::int FROM public.household_members WHERE household_id = p_household_id AND role = 'owner'
$$;

CREATE FUNCTION public.set_member_role(p_household_id uuid, p_user_id uuid, p_role public.member_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_household_owner(p_household_id) THEN
    RAISE EXCEPTION 'only an owner can change roles' USING ERRCODE = '42501';
  END IF;
  -- Do not demote the last owner.
  IF p_role <> 'owner'
     AND EXISTS (SELECT 1 FROM public.household_members WHERE household_id = p_household_id AND user_id = p_user_id AND role = 'owner')
     AND public.owner_count(p_household_id) <= 1 THEN
    RAISE EXCEPTION 'a household must keep an owner' USING ERRCODE = '22023';
  END IF;
  UPDATE public.household_members SET role = p_role
   WHERE household_id = p_household_id AND user_id = p_user_id;
END
$$;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, public.member_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, public.member_role) TO authenticated;

CREATE FUNCTION public.remove_household_member(p_household_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_household_owner(p_household_id) THEN
    RAISE EXCEPTION 'only an owner can remove members' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.household_members WHERE household_id = p_household_id AND user_id = p_user_id AND role = 'owner')
     AND public.owner_count(p_household_id) <= 1 THEN
    RAISE EXCEPTION 'a household must keep an owner' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.household_members WHERE household_id = p_household_id AND user_id = p_user_id;
  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('household_member_removed', auth.uid(), jsonb_build_object('household', p_household_id, 'removed', p_user_id));
END
$$;
REVOKE ALL ON FUNCTION public.remove_household_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_household_member(uuid, uuid) TO authenticated;

CREATE FUNCTION public.leave_household(p_household_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.household_members WHERE household_id = p_household_id AND user_id = auth.uid() AND role = 'owner')
     AND public.owner_count(p_household_id) <= 1 THEN
    RAISE EXCEPTION 'the last owner cannot leave; transfer ownership or delete the household' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.household_members WHERE household_id = p_household_id AND user_id = auth.uid();
END
$$;
REVOKE ALL ON FUNCTION public.leave_household(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_household(uuid) TO authenticated;

-- Release a device from the account (e.g. before selling it). It returns to
-- 'unclaimed' with no household, so a new owner can factory-reset and adopt it.
CREATE FUNCTION public.release_device(p_device_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  hh uuid;
BEGIN
  SELECT household_id INTO hh FROM public.devices WHERE id = p_device_id;
  IF hh IS NULL OR NOT public.is_household_owner(hh) THEN
    RAISE EXCEPTION 'only an owner can release a device' USING ERRCODE = '42501';
  END IF;
  UPDATE public.devices
     SET household_id = NULL, target_list_id = NULL, status = 'unclaimed', pending_command = NULL, name = NULL
   WHERE id = p_device_id;
  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('device_released', auth.uid(), jsonb_build_object('device', p_device_id));
END
$$;
REVOKE ALL ON FUNCTION public.release_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_device(uuid) TO authenticated;
