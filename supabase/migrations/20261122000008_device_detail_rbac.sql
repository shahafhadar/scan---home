-- Device detail actions need to know the caller's role, and renaming a device
-- -- like issuing a command -- should not be open to a viewer. The original
-- "members rename their devices" policy (init migration) allowed any member,
-- viewer included, to write devices.name directly; tighten it to match the
-- same non-viewer rule issue_device_command already enforces.

-- The caller's role in a household, or NULL if they are not a member (or not
-- active). Reusable anywhere a policy or function needs to branch on role.
CREATE FUNCTION public.my_role_in(p_household_id uuid)
RETURNS public.member_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.role FROM public.household_members m
   WHERE m.household_id = p_household_id AND m.user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'active')
$$;
GRANT EXECUTE ON FUNCTION public.my_role_in(uuid) TO authenticated;

DROP POLICY "members rename their devices" ON public.devices;
CREATE POLICY "members rename their devices" ON public.devices
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.my_household_ids()) AND public.my_role_in(household_id) <> 'viewer')
  WITH CHECK (household_id IN (SELECT public.my_household_ids()) AND public.my_role_in(household_id) <> 'viewer');
