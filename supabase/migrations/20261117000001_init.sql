-- scan-home: initial schema.
--
-- Two very different callers write here:
--   * people, through the web app, signed in with Supabase Auth. They reach
--     the database directly with their own JWT, so every table they can touch
--     has row level security, and the only thing that decides what they see
--     is which household they belong to.
--   * scanners, through the signed device API in the Next.js server. That
--     server connects as a privileged role and calls the device_* functions
--     below; people can never call those.
--
-- Devices belong to a household, never to a user, so a scan lands in the right
-- list no matter who is holding the scanner.

-- ---------------------------------------------------------------- households

CREATE TABLE public.households (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.member_role AS ENUM ('owner', 'member', 'viewer');

CREATE TABLE public.household_members (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         public.member_role NOT NULL DEFAULT 'member',
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX household_members_user ON public.household_members (user_id);

-- The households the signed-in person belongs to. SECURITY DEFINER so that
-- policies can call it without recursing into household_members' own policy.
CREATE FUNCTION public.my_household_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT household_id FROM public.household_members WHERE user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- lists

CREATE TABLE public.lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active list per household: it is the list scans land in.
CREATE UNIQUE INDEX lists_one_active_per_household
  ON public.lists (household_id) WHERE is_active;

-- ---------------------------------------------------------------- devices

CREATE TYPE public.device_status AS ENUM ('unclaimed', 'active', 'disabled');

CREATE TABLE public.devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial           text UNIQUE NOT NULL,
  -- sha256 of the secret the device minted for itself. The device signs with
  -- this value and it never crosses the network after registration. HMAC is
  -- symmetric, so whoever reads this column can forge that device's scans:
  -- people never get to read it (see the column grants at the bottom).
  secret_hash      text NOT NULL,
  pairing_code     text UNIQUE NOT NULL,
  household_id     uuid REFERENCES public.households(id) ON DELETE SET NULL,
  target_list_id   uuid REFERENCES public.lists(id) ON DELETE SET NULL,
  name             text,
  status           public.device_status NOT NULL DEFAULT 'unclaimed',
  firmware_version text,
  hw_revision      text,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Telemetry, refreshed by every heartbeat. Without these, every fault in
  -- the field is a phone call: a leak shows as min_heap falling day over day,
  -- a loose socket as usb_restarts climbing, a flapping router as
  -- wifi_reconnects. scanner_attached and keys_seen are what finally told an
  -- unpowered scanner apart from a silent one on the prototype.
  last_rssi        int,
  scanner_attached boolean,
  keys_seen        bigint NOT NULL DEFAULT 0,
  uptime_seconds   bigint,
  reset_reason     text,
  boot_count       int,
  failed_boots     int,
  safe_mode        boolean NOT NULL DEFAULT false,
  ota_probation    boolean,
  self_test_ok     boolean,
  free_heap        int,
  min_heap         int,
  queue_size       int NOT NULL DEFAULT 0,
  queue_failed     int NOT NULL DEFAULT 0,
  queue_dropped    int NOT NULL DEFAULT 0,
  error_count      int NOT NULL DEFAULT 0,
  wifi_reconnects  int NOT NULL DEFAULT 0,
  usb_restarts     int NOT NULL DEFAULT 0,

  -- Command channel: the heartbeat reply carries at most one command.
  pending_command      jsonb,
  last_command         jsonb,
  last_command_sent_at timestamptz
);

CREATE INDEX devices_household ON public.devices (household_id);

-- One row a minute per device, so a trend is visible and not just the latest
-- reading. A leak is only visible as a slope.
CREATE TABLE public.device_health (
  device_id      uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  uptime_seconds bigint,
  free_heap      int,
  min_heap       int,
  queue_size     int,
  error_count    int,
  rssi           int,
  scanner_attached boolean,
  PRIMARY KEY (device_id, at)
);

-- A full snapshot, sent by the device only when asked. Kept as it arrived.
CREATE TABLE public.device_diagnostics (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  snapshot  jsonb NOT NULL
);

CREATE INDEX device_diagnostics_recent ON public.device_diagnostics (device_id, at DESC);

-- Codes that travel from the app to the device, never the other way.
--
-- The device's setup page lives on a WiFi network the phone abandons seconds
-- after setup succeeds, so anything the device tries to hand back is racing a
-- disappearing screen. A code the person reads in the app and types into that
-- page has no such race. This is the version that worked on the prototype.
CREATE TABLE public.claim_tokens (
  token        text PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Short lived: read off one screen and typed into another, in one sitting.
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  used_by      uuid REFERENCES public.devices(id) ON DELETE SET NULL
);

CREATE INDEX claim_tokens_household ON public.claim_tokens (household_id);

-- ---------------------------------------------------------------- catalog

-- Global product catalog: imported, then improved by what people teach it.
CREATE TABLE public.products (
  barcode    text PRIMARY KEY,
  name       text NOT NULL,
  brand      text,
  category   text,
  image_url  text,
  source     text NOT NULL DEFAULT 'catalog',
  verified   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A household's own name for a barcode always wins over the global catalog.
CREATE TABLE public.household_products (
  household_id     uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  barcode          text NOT NULL,
  name             text NOT NULL,
  default_quantity numeric NOT NULL DEFAULT 1,
  default_unit     text,
  target_list_id   uuid REFERENCES public.lists(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, barcode)
);

-- ---------------------------------------------------------------- items and scans

CREATE TYPE public.item_status AS ENUM ('pending', 'purchased', 'removed');

CREATE TABLE public.list_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id            uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  -- Denormalised from the list so that row level security and realtime
  -- filters are a plain column check, not a join.
  household_id       uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  barcode            text,
  name               text NOT NULL,
  quantity           numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit               text,
  status             public.item_status NOT NULL DEFAULT 'pending',
  identified         boolean NOT NULL DEFAULT true,
  note               text,
  added_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by_device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX list_items_list_status ON public.list_items (list_id, status);
CREATE INDEX list_items_household ON public.list_items (household_id);

-- One pending row per barcode per list, so a repeat scan bumps the quantity
-- instead of adding a second line. Enforced here because two people can scan
-- the same thing at the same moment.
CREATE UNIQUE INDEX list_items_one_pending_barcode
  ON public.list_items (list_id, barcode) WHERE status = 'pending' AND barcode IS NOT NULL;

-- Keeps household_id in step with list_id, whoever writes the row.
CREATE FUNCTION public.list_items_set_household()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  SELECT l.household_id INTO NEW.household_id FROM public.lists l WHERE l.id = NEW.list_id;
  IF NEW.household_id IS NULL THEN
    RAISE EXCEPTION 'list % does not exist', NEW.list_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER list_items_household
  BEFORE INSERT OR UPDATE OF list_id, name, quantity, unit, status, note ON public.list_items
  FOR EACH ROW EXECUTE FUNCTION public.list_items_set_household();

-- Raw scan log. scan_id is minted on the device and is the primary key: that
-- is what makes a resend after a dropped reply harmless.
CREATE TABLE public.scans (
  scan_id      uuid PRIMARY KEY,
  device_id    uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  barcode      text NOT NULL,
  symbology    text,
  scanned_at   timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  was_queued   boolean NOT NULL DEFAULT false,
  quantity     numeric NOT NULL DEFAULT 1,
  list_item_id uuid REFERENCES public.list_items(id) ON DELETE SET NULL
);

CREATE INDEX scans_device_time ON public.scans (device_id, received_at DESC);
-- Scans recorded before the device was paired, waiting to be replayed.
CREATE INDEX scans_held ON public.scans (device_id, scanned_at) WHERE list_item_id IS NULL;

-- ---------------------------------------------------------------- new accounts

-- Every new person gets a household and an active list, so the first thing
-- they see after signing in is a list that is ready to receive scans.
CREATE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
BEGIN
  INSERT INTO public.households (name) VALUES ('הבית שלי') RETURNING id INTO household;
  INSERT INTO public.household_members (household_id, user_id, role) VALUES (household, NEW.id, 'owner');
  INSERT INTO public.lists (household_id, name, is_active) VALUES (household, 'רשימת קניות', true);
  RETURN NEW;
END
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------- scan ingestion

-- Turns a barcode into a name, most specific source first. The last layer
-- always succeeds: a scan that cannot be named is still a scan the person
-- made, and must not vanish.
--
-- A barcode can be printed as UPC-A (12 digits) and stored as EAN-13 (13, with
-- a leading zero), or the other way round, so every spelling is tried.
CREATE FUNCTION public.barcode_variants(p_barcode text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN btrim(p_barcode) ~ '^[0-9]+$' THEN ARRAY(SELECT DISTINCT v FROM unnest(ARRAY[
      btrim(p_barcode),
      lpad(btrim(p_barcode), 13, '0'),
      lpad(btrim(p_barcode), 12, '0'),
      coalesce(nullif(ltrim(btrim(p_barcode), '0'), ''), '0')
    ]) AS v)
    ELSE ARRAY[btrim(p_barcode)]
  END
$$;

/*
 * Records one scan from a device. Safe to call any number of times with the
 * same scan_id: the scan row is inserted first, inside the same transaction,
 * so a resend -- even one racing the original -- finds it and stops there.
 *
 * Outcomes: added | bumped | duplicate | held (device not paired yet).
 * p_external_name is a name the caller already found online, used only when
 * neither the household nor the catalog knows the barcode.
 */
CREATE FUNCTION public.device_ingest_scan(
  p_device_id     uuid,
  p_scan_id       uuid,
  p_barcode       text,
  p_symbology     text DEFAULT NULL,
  p_scanned_at    timestamptz DEFAULT now(),
  p_queued        boolean DEFAULT false,
  p_quantity      numeric DEFAULT 1,
  p_external_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  dev        public.devices%ROWTYPE;
  variants   text[] := public.barcode_variants(p_barcode);
  delta      numeric := CASE WHEN p_quantity > 0 THEN p_quantity ELSE 1 END;
  item_name  text;
  item_unit  text;
  item_qty   numeric := 1;
  known      boolean := true;
  list       uuid;
  item_id    uuid;
  item_list  uuid;
  final_name text;
  final_qty  numeric;
  final_known boolean;
  created    boolean;
BEGIN
  -- A device sending scans is plainly alive. Waiting for the next heartbeat
  -- would show a working scanner as offline for up to a minute.
  UPDATE public.devices SET last_seen_at = now() WHERE id = p_device_id RETURNING * INTO dev;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown device %', p_device_id;
  END IF;

  INSERT INTO public.scans (scan_id, device_id, barcode, symbology, scanned_at, was_queued, quantity)
       VALUES (p_scan_id, p_device_id, btrim(p_barcode), p_symbology, p_scanned_at, p_queued, delta)
  ON CONFLICT (scan_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('scan_id', p_scan_id, 'status', 'duplicate');
  END IF;

  -- A device that is powered on but not yet paired still records what it
  -- sees. Pairing replays these, so the owner's first test scan is not lost.
  IF dev.household_id IS NULL THEN
    RETURN jsonb_build_object('scan_id', p_scan_id, 'status', 'held');
  END IF;

  SELECT hp.name, hp.default_unit, hp.default_quantity, hp.target_list_id
    INTO item_name, item_unit, item_qty, list
    FROM public.household_products hp
   WHERE hp.household_id = dev.household_id AND hp.barcode = ANY (variants)
   LIMIT 1;

  IF item_name IS NULL THEN
    item_qty := 1;
    SELECT CASE WHEN p.brand IS NOT NULL AND position(p.brand IN p.name) = 0
                THEN p.name || ' ' || p.brand ELSE p.name END
      INTO item_name
      FROM public.products p
     WHERE p.barcode = ANY (variants)
     LIMIT 1;
  END IF;

  IF item_name IS NULL AND nullif(btrim(p_external_name), '') IS NOT NULL THEN
    item_name := btrim(p_external_name);
    -- Remember it, so the next household that scans it gets it instantly.
    INSERT INTO public.products (barcode, name, source)
         VALUES (btrim(p_barcode), item_name, 'openfoodfacts')
    ON CONFLICT (barcode) DO NOTHING;
  END IF;

  IF item_name IS NULL THEN
    item_name := 'ברקוד ' || btrim(p_barcode);
    known := false;
  END IF;

  list := coalesce(list, dev.target_list_id, (
    SELECT l.id FROM public.lists l
     WHERE l.household_id = dev.household_id AND l.is_active AND l.archived_at IS NULL
     LIMIT 1));
  IF list IS NULL THEN
    RAISE EXCEPTION 'household % has no active list', dev.household_id;
  END IF;

  -- The partial unique index makes this the atomic merge point: two people
  -- scanning the same milk at once produce one row with quantity 2.
  -- xmax is 0 only on a row this statement inserted rather than updated.
  INSERT INTO public.list_items AS li (list_id, household_id, barcode, name, quantity, unit, identified, added_by_device_id)
       VALUES (list, dev.household_id, btrim(p_barcode), item_name, delta * item_qty, item_unit, known, p_device_id)
  ON CONFLICT (list_id, barcode) WHERE status = 'pending' AND barcode IS NOT NULL
  DO UPDATE SET quantity = li.quantity + excluded.quantity
  RETURNING li.id, li.list_id, li.name, li.quantity, li.identified, (li.xmax = 0)
       INTO item_id, item_list, final_name, final_qty, final_known, created;

  UPDATE public.scans SET list_item_id = item_id WHERE scan_id = p_scan_id;

  RETURN jsonb_build_object(
    'scan_id', p_scan_id,
    'status', CASE WHEN created THEN 'added' ELSE 'bumped' END,
    'name', final_name,
    'identified', final_known,
    'quantity', final_qty,
    'list_id', item_list,
    'item_id', item_id
  );
END
$$;

-- Attaches the scans a device recorded before it was paired (last 24 hours).
CREATE FUNCTION public.device_replay_held_scans(p_device_id uuid)
RETURNS int LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  held   public.scans%ROWTYPE;
  n      int := 0;
BEGIN
  FOR held IN
    SELECT * FROM public.scans
     WHERE device_id = p_device_id AND list_item_id IS NULL
       AND received_at > now() - interval '24 hours'
     ORDER BY scanned_at
  LOOP
    -- Drop the placeholder so the ingest does not see it as a duplicate.
    DELETE FROM public.scans WHERE scan_id = held.scan_id;
    PERFORM public.device_ingest_scan(p_device_id, held.scan_id, held.barcode, held.symbology,
                                      held.scanned_at, true, held.quantity);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

-- ---------------------------------------------------------------- pairing

-- No 0/O/1/I: the code is read off a screen and typed by hand.
CREATE FUNCTION public.random_code(p_length int DEFAULT 6)
RETURNS text LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  -- The first six bytes of a v4 UUID are fully random, and 256 is a multiple
  -- of 32, so every character is equally likely.
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i % 6) % 32), 1), '' ORDER BY i)
    FROM (SELECT uuid_send(gen_random_uuid()) AS b) r,
         generate_series(0, least(p_length, 6) - 1) AS i
$$;

-- Binds a device to the household that issued the token and burns the token,
-- in one go: a token consumed without the device being claimed would leave
-- the person holding a code that quietly does nothing.
CREATE FUNCTION public.apply_claim_token(p_device_id uuid, p_token text)
RETURNS boolean LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  household uuid;
BEGIN
  UPDATE public.claim_tokens
     SET used_at = now(), used_by = p_device_id
   WHERE token = upper(btrim(p_token)) AND used_at IS NULL AND expires_at > now()
  RETURNING household_id INTO household;
  IF household IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.devices
     SET household_id = household,
         target_list_id = (SELECT id FROM public.lists WHERE household_id = household AND is_active LIMIT 1),
         status = 'active'
   WHERE id = p_device_id;

  PERFORM public.device_replay_held_scans(p_device_id);
  RETURN true;
END
$$;

/*
 * First boot, and every boot until the device hears back. The device mints
 * its own secret and sends only the hash. Self registration is acceptable
 * because an unclaimed device can do nothing until a signed-in person hands
 * it a code from the app.
 *
 * Same serial, same hash  -> a retry because our reply was lost.
 * Same serial, new hash   -> a factory reset: the serial comes from the MAC
 *                            and never changes, the secret is fresh. Take the
 *                            new secret and put the device back in the box,
 *                            so a resold scanner does not keep feeding its
 *                            previous owner's list.
 */
CREATE FUNCTION public.device_register(
  p_serial       text,
  p_secret_hash  text,
  p_firmware     text DEFAULT NULL,
  p_pairing_code text DEFAULT NULL,
  p_claim_token  text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  dev     public.devices%ROWTYPE;
  code    text;
  created boolean := false;
  claimed boolean := false;
  attempt int := 0;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE serial = p_serial FOR UPDATE;

  IF FOUND AND dev.secret_hash <> p_secret_hash THEN
    UPDATE public.devices
       SET secret_hash = p_secret_hash,
           pairing_code = public.random_code(),
           household_id = NULL,
           target_list_id = NULL,
           status = 'unclaimed',
           firmware_version = coalesce(p_firmware, firmware_version),
           pending_command = NULL
     WHERE id = dev.id
    RETURNING * INTO dev;
    -- Scans recorded under the old owner must not replay into the new one.
    DELETE FROM public.scans WHERE device_id = dev.id AND list_item_id IS NULL;
  ELSIF NOT FOUND THEN
    -- Take the device's own code when it is free: it may already be showing
    -- it on its setup page. Otherwise fall back to one that is unused.
    code := CASE WHEN p_pairing_code ~ '^[A-Z2-9]{6}$' THEN p_pairing_code ELSE public.random_code() END;
    LOOP
      INSERT INTO public.devices (serial, secret_hash, pairing_code, firmware_version)
           VALUES (p_serial, p_secret_hash, code, p_firmware)
      ON CONFLICT (pairing_code) DO NOTHING
      RETURNING * INTO dev;
      EXIT WHEN FOUND;
      attempt := attempt + 1;
      IF attempt > 5 THEN
        RAISE EXCEPTION 'could not allocate a pairing code';
      END IF;
      code := public.random_code();
    END LOOP;
    created := true;
  END IF;

  -- A retry carrying a claim token still has to claim: the lost reply must
  -- not cost the person their pairing.
  IF p_claim_token IS NOT NULL AND dev.status <> 'active' THEN
    claimed := public.apply_claim_token(dev.id, p_claim_token);
    SELECT * INTO dev FROM public.devices WHERE id = dev.id;
  END IF;

  RETURN jsonb_build_object(
    'pairing_code', dev.pairing_code,
    'status', dev.status,
    'claimed', claimed,
    'created', created
  );
END
$$;

-- Heartbeat: telemetry in, at most one command out.
CREATE FUNCTION public.device_heartbeat(p_device_id uuid, p_beat jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  command jsonb;
BEGIN
  UPDATE public.devices SET
    last_seen_at     = now(),
    firmware_version = coalesce(p_beat->>'fw', firmware_version),
    last_rssi        = coalesce((p_beat->>'rssi')::int, last_rssi),
    scanner_attached = coalesce((p_beat->>'scanner_attached')::boolean, scanner_attached),
    keys_seen        = coalesce((p_beat->>'keys_seen')::bigint, keys_seen),
    uptime_seconds   = coalesce((p_beat->>'uptime')::bigint, uptime_seconds),
    reset_reason     = coalesce(p_beat->>'reset_reason', reset_reason),
    boot_count       = coalesce((p_beat->>'boot_count')::int, boot_count),
    failed_boots     = coalesce((p_beat->>'failed_boots')::int, failed_boots),
    safe_mode        = coalesce((p_beat->>'safe_mode')::boolean, safe_mode),
    ota_probation    = coalesce((p_beat->>'ota_probation')::boolean, ota_probation),
    hw_revision      = coalesce(p_beat->>'hw', hw_revision),
    self_test_ok     = coalesce((p_beat->>'self_test')::boolean, self_test_ok),
    free_heap        = coalesce((p_beat->>'free_heap')::int, free_heap),
    min_heap         = coalesce((p_beat->>'min_heap')::int, min_heap),
    queue_size       = coalesce((p_beat->>'queue_size')::int, queue_size),
    queue_failed     = coalesce((p_beat->>'queue_failed')::int, queue_failed),
    queue_dropped    = coalesce((p_beat->>'queue_dropped')::int, queue_dropped),
    error_count      = coalesce((p_beat->>'errors')::int, error_count),
    wifi_reconnects  = coalesce((p_beat->>'wifi_reconnects')::int, wifi_reconnects),
    usb_restarts     = coalesce((p_beat->>'usb_restarts')::int, usb_restarts)
  WHERE id = p_device_id;

  IF p_beat ? 'free_heap' THEN
    INSERT INTO public.device_health (device_id, uptime_seconds, free_heap, min_heap, queue_size, error_count, rssi, scanner_attached)
         VALUES (p_device_id, (p_beat->>'uptime')::bigint, (p_beat->>'free_heap')::int, (p_beat->>'min_heap')::int,
                 (p_beat->>'queue_size')::int, (p_beat->>'errors')::int, (p_beat->>'rssi')::int,
                 (p_beat->>'scanner_attached')::boolean)
    ON CONFLICT DO NOTHING;
    DELETE FROM public.device_health WHERE device_id = p_device_id AND at < now() - interval '14 days';
  END IF;

  -- Handed over exactly once, and remembered.
  --
  -- On the prototype this read `RETURNING pending_command`, which returns the
  -- row *after* the update -- always NULL -- so no command ever reached a
  -- device. Every expression in SET reads the old row, so last_command holds
  -- the command being handed over, and returning it returns the real value.
  UPDATE public.devices
     SET pending_command = NULL, last_command = pending_command, last_command_sent_at = now()
   WHERE id = p_device_id AND pending_command IS NOT NULL
  RETURNING last_command INTO command;

  RETURN command;
END
$$;

-- ---------------------------------------------------------------- functions people call

-- Issues a code for the person to type into a device's setup page.
CREATE FUNCTION public.create_claim_token()
RETURNS TABLE (token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
  attempt   int := 0;
BEGIN
  SELECT household_id INTO household FROM public.household_members WHERE user_id = auth.uid() LIMIT 1;
  IF household IS NULL THEN
    RAISE EXCEPTION 'not signed in, or no household' USING ERRCODE = '42501';
  END IF;

  LOOP
    BEGIN
      -- Twenty minutes: long enough to walk to the kitchen and type it,
      -- short enough that a code left on a screen stops being useful.
      RETURN QUERY
        INSERT INTO public.claim_tokens (token, household_id, created_by, expires_at)
             VALUES (public.random_code(), household, auth.uid(), now() + interval '20 minutes')
        RETURNING claim_tokens.token, claim_tokens.expires_at;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      attempt := attempt + 1;
      IF attempt > 5 THEN RAISE; END IF;
    END;
  END LOOP;
END
$$;

-- Fallback pairing: the person types the code a device shows on its page.
CREATE FUNCTION public.claim_device(p_code text, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
  dev       public.devices%ROWTYPE;
  replayed  int;
BEGIN
  SELECT household_id INTO household FROM public.household_members WHERE user_id = auth.uid() LIMIT 1;
  IF household IS NULL THEN
    RAISE EXCEPTION 'not signed in, or no household' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO dev FROM public.devices
   WHERE pairing_code = regexp_replace(upper(p_code), '[\s-]', '', 'g') FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'לא נמצא מכשיר עם הקוד הזה');
  END IF;
  IF dev.household_id IS NOT NULL AND dev.household_id <> household THEN
    RETURN jsonb_build_object('ok', false, 'error', 'המכשיר כבר משויך לחשבון אחר');
  END IF;

  UPDATE public.devices
     SET household_id = household,
         target_list_id = (SELECT id FROM public.lists WHERE household_id = household AND is_active LIMIT 1),
         status = 'active',
         name = coalesce(nullif(btrim(p_name), ''), name)
   WHERE id = dev.id;

  replayed := public.device_replay_held_scans(dev.id);
  RETURN jsonb_build_object('ok', true, 'device_id', dev.id, 'replayed_scans', replayed);
END
$$;

-- Naming an unknown barcode. Remembered for this household, seeded into the
-- shared catalog, and applied to the row already waiting on the list.
CREATE FUNCTION public.identify_product(p_barcode text, p_name text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  household uuid;
  n         int;
BEGIN
  SELECT household_id INTO household FROM public.household_members WHERE user_id = auth.uid() LIMIT 1;
  IF household IS NULL THEN
    RAISE EXCEPTION 'not signed in, or no household' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid name' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.household_products (household_id, barcode, name)
       VALUES (household, btrim(p_barcode), btrim(p_name))
  ON CONFLICT (household_id, barcode) DO UPDATE SET name = excluded.name, updated_at = now();

  INSERT INTO public.products (barcode, name, source)
       VALUES (btrim(p_barcode), btrim(p_name), 'community')
  ON CONFLICT (barcode) DO NOTHING;

  UPDATE public.list_items
     SET name = btrim(p_name), identified = true
   WHERE household_id = household AND barcode = btrim(p_barcode) AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ---------------------------------------------------------------- row level security

ALTER TABLE public.households         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_health      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read their household" ON public.households
  FOR SELECT TO authenticated USING (id IN (SELECT public.my_household_ids()));
CREATE POLICY "members rename their household" ON public.households
  FOR UPDATE TO authenticated USING (id IN (SELECT public.my_household_ids()));

CREATE POLICY "members see each other" ON public.household_members
  FOR SELECT TO authenticated USING (household_id IN (SELECT public.my_household_ids()));

CREATE POLICY "members use their lists" ON public.lists
  FOR ALL TO authenticated
  USING (household_id IN (SELECT public.my_household_ids()))
  WITH CHECK (household_id IN (SELECT public.my_household_ids()));

CREATE POLICY "members use their items" ON public.list_items
  FOR ALL TO authenticated
  USING (household_id IN (SELECT public.my_household_ids()))
  WITH CHECK (household_id IN (SELECT public.my_household_ids()));

CREATE POLICY "members see their devices" ON public.devices
  FOR SELECT TO authenticated USING (household_id IN (SELECT public.my_household_ids()));
CREATE POLICY "members rename their devices" ON public.devices
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.my_household_ids()))
  WITH CHECK (household_id IN (SELECT public.my_household_ids()));

CREATE POLICY "members see device health" ON public.device_health
  FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.devices WHERE household_id IN (SELECT public.my_household_ids())));

CREATE POLICY "members see their scans" ON public.scans
  FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.devices WHERE household_id IN (SELECT public.my_household_ids())));

CREATE POLICY "anyone signed in reads the catalog" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "members use their product names" ON public.household_products
  FOR ALL TO authenticated
  USING (household_id IN (SELECT public.my_household_ids()))
  WITH CHECK (household_id IN (SELECT public.my_household_ids()));

-- claim_tokens and device_diagnostics: no policies, so no direct access.

-- ---------------------------------------------------------------- grants

-- Supabase grants every role everything on new objects by default. Take it
-- back, then hand out exactly what the web app needs.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT SELECT, UPDATE (name) ON public.households TO authenticated;
GRANT SELECT ON public.household_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lists TO authenticated;
GRANT SELECT, INSERT (list_id, name, quantity, unit, note, barcode, added_by_user_id),
      UPDATE (name, quantity, unit, note, status) ON public.list_items TO authenticated;
-- Every column except the secret hash, the pairing code and the command channel.
GRANT SELECT (id, serial, household_id, target_list_id, name, status, firmware_version, hw_revision,
              last_seen_at, created_at, last_rssi, scanner_attached, keys_seen, uptime_seconds,
              reset_reason, boot_count, failed_boots, safe_mode, ota_probation, self_test_ok,
              free_heap, min_heap, queue_size, queue_failed, queue_dropped, error_count,
              wifi_reconnects, usb_restarts, last_command_sent_at)
   ON public.devices TO authenticated;
GRANT UPDATE (name, target_list_id) ON public.devices TO authenticated;
GRANT SELECT ON public.device_health TO authenticated;
GRANT SELECT (scan_id, device_id, barcode, scanned_at, received_at, was_queued, list_item_id)
   ON public.scans TO authenticated;
GRANT SELECT ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_products TO authenticated;

GRANT EXECUTE ON FUNCTION public.my_household_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_claim_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.identify_product(text, text) TO authenticated;
-- Trigger functions run as the table owner; no grant needed for them.

-- ---------------------------------------------------------------- realtime

-- The list updates live: every browser in the household hears about a scan
-- the moment it lands. Realtime respects the policies above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Only list_items. devices carries the secret hash, so it stays out of
    -- the replication stream; the devices screen polls instead.
    ALTER PUBLICATION supabase_realtime ADD TABLE public.list_items;
  END IF;
END
$$;
