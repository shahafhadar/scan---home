-- Adopt-by-serial: a simpler way to add a scanner. The device's setup portal
-- now collects only the home WiFi, so the device registers itself as unclaimed
-- and the app adopts it with one tap -- no pairing code to type or carry.
--
-- Because an unclaimed device is bound by whoever adopts it first, adoption is
-- limited to devices seen very recently, the caller confirms by the serial
-- printed on the device, first-adopter-wins, each adoption is audited, and a
-- single account cannot adopt more than a handful an hour. The code-based
-- claim_device() path stays as the stronger, manual fallback.

-- How recently a device must have registered or phoned home to be adoptable.
-- (A constant kept in one place via a tiny immutable helper.)
CREATE FUNCTION public.adopt_window() RETURNS interval
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT interval '10 minutes' $$;

-- The unclaimed devices a signed-in person may adopt right now: still unclaimed
-- and seen within the window. Returns only what the app shows -- never the
-- secret hash or pairing code. SECURITY DEFINER because RLS hides a device with
-- no household from everyone.
CREATE FUNCTION public.list_adoptable_devices()
RETURNS TABLE (serial text, last4 text, firmware_version text, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.serial,
         right(d.serial, 4) AS last4,
         d.firmware_version,
         d.last_seen_at
    FROM public.devices d
   WHERE d.household_id IS NULL
     AND d.status = 'unclaimed'
     AND coalesce(d.last_seen_at, d.created_at) > now() - public.adopt_window()
     AND auth.uid() IS NOT NULL
   ORDER BY coalesce(d.last_seen_at, d.created_at) DESC
   LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.list_adoptable_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_adoptable_devices() TO authenticated;

-- Adopt a device by its serial: bind it to the caller's household, like
-- claim_device() does for a pairing code, but without a code. Guarded by the
-- recency window, first-adopter-wins, a per-account hourly cap, and an audit
-- row.
CREATE FUNCTION public.adopt_device(p_serial text, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
  dev       public.devices%ROWTYPE;
  replayed  int;
  recent    int;
BEGIN
  SELECT household_id INTO household FROM public.household_members WHERE user_id = auth.uid() LIMIT 1;
  IF household IS NULL THEN
    RAISE EXCEPTION 'not signed in, or no household' USING ERRCODE = '42501';
  END IF;

  -- A runaway or abusive client cannot sweep up devices: cap adoptions per hour.
  SELECT count(*) INTO recent
    FROM public.security_events
   WHERE event = 'device_adopted' AND user_id = auth.uid() AND at > now() - interval '1 hour';
  IF recent >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'יותר מדי מכשירים נוספו. נסו שוב בעוד שעה.');
  END IF;

  SELECT * INTO dev FROM public.devices WHERE serial = p_serial FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'לא נמצא מכשיר כזה');
  END IF;

  -- Already mine: idempotent, so a double tap is harmless.
  IF dev.household_id = household THEN
    RETURN jsonb_build_object('ok', true, 'device_id', dev.id, 'replayed_scans', 0);
  END IF;
  -- First-adopter-wins: someone (or some other household) already has it.
  IF dev.household_id IS NOT NULL OR dev.status <> 'unclaimed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'המכשיר כבר משויך');
  END IF;
  -- Only a device that just announced itself may be adopted this way.
  IF coalesce(dev.last_seen_at, dev.created_at) <= now() - public.adopt_window() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'המכשיר לא נראה לאחרונה. הפעילו אותו מחדש ונסו שוב.');
  END IF;

  UPDATE public.devices
     SET household_id = household,
         target_list_id = (SELECT id FROM public.lists WHERE household_id = household AND is_active LIMIT 1),
         status = 'active',
         name = coalesce(nullif(btrim(p_name), ''), name)
   WHERE id = dev.id;

  replayed := public.device_replay_held_scans(dev.id);

  INSERT INTO public.security_events (event, user_id, meta)
       VALUES ('device_adopted', auth.uid(), jsonb_build_object('serial', dev.serial));

  RETURN jsonb_build_object('ok', true, 'device_id', dev.id, 'replayed_scans', replayed);
END
$$;
REVOKE ALL ON FUNCTION public.adopt_device(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adopt_device(text, text) TO authenticated;
