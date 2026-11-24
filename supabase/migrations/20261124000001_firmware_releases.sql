-- Automatic firmware updates (docs/firmware-ota.md).
--
-- A release is a signed image that may be offered to devices of the same build
-- and board. It is uploaded as a draft (rollout 0%) and offered only once
-- published; the offer rides on the heartbeat reply, so there is no new
-- channel and no broker. The images live here as bytea -- about 1.6MB each,
-- fine for a small fleet, and it needs no storage credentials: the device
-- routes already hold the database connection. Past a few thousand devices
-- this belongs in object storage behind a CDN.

-- 1.2.3 -> 1002003. NULL for anything that is not major.minor.patch, so an
-- unparseable version is never "older" than anything and is never offered.
CREATE FUNCTION public.firmware_version_code(p_version text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
    THEN split_part(p_version, '.', 1)::int * 1000000
       + split_part(p_version, '.', 2)::int * 1000
       + split_part(p_version, '.', 3)::int
  END
$$;

CREATE TABLE public.firmware_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         text NOT NULL CHECK (public.firmware_version_code(version) IS NOT NULL),
  version_code    int  GENERATED ALWAYS AS (public.firmware_version_code(version)) STORED,
  -- What the image says about itself (its SCANCART-IMAGE tag), not what the
  -- uploader claimed: the build it was compiled as, the board, and the host
  -- it talks to.
  build           text NOT NULL CHECK (build ~ '^[a-z0-9_-]{1,32}$'),
  hw              text NOT NULL CHECK (length(hw) BETWEEN 1 AND 64),
  host            text NOT NULL,
  size            int  NOT NULL CHECK (size > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  signature       bytea NOT NULL,
  image           bytea NOT NULL,
  -- Devices whose bucket (a hash of their id, fixed) is below this get it.
  rollout_percent int  NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  -- Pulled: never offered again. Devices already on it fix forward to a
  -- higher version; there are no downgrades.
  yanked          boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, build, hw)
);

CREATE INDEX firmware_releases_offer ON public.firmware_releases (build, hw, version_code DESC)
  WHERE NOT yanked;

-- Only the signed device routes (the server's own connection) touch releases.
ALTER TABLE public.firmware_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.firmware_releases FROM PUBLIC, anon, authenticated;

-- What the device reports about updating (heartbeat `build` and `ota`).
ALTER TABLE public.devices
  ADD COLUMN firmware_build       text,
  ADD COLUMN ota_state            text,
  ADD COLUMN ota_target_version   text,
  ADD COLUMN ota_rejected_version text,
  ADD COLUMN ota_error            text,
  ADD COLUMN ota_updated_at       timestamptz;

GRANT SELECT (firmware_build, ota_state, ota_target_version, ota_rejected_version, ota_error, ota_updated_at)
   ON public.devices TO authenticated;

-- The release this device should move to, as the heartbeat's `update`, or
-- NULL. Newer than what it runs, same build and board, not yanked, inside the
-- rollout, and not a version the device already installed and rolled back
-- from (that one is dead to it).
CREATE FUNCTION public.firmware_offer(p_device_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
           'version', r.version,
           'path', '/api/v1/firmware/' || r.id || '.bin',
           'size', r.size,
           'sha256', r.sha256)
    FROM public.devices d
    JOIN public.firmware_releases r ON r.build = d.firmware_build AND r.hw = d.hw_revision
   WHERE d.id = p_device_id
     AND NOT r.yanked
     AND r.version_code > public.firmware_version_code(d.firmware_version)
     AND r.version IS DISTINCT FROM d.ota_rejected_version
     AND abs(hashtext(d.id::text)::bigint) % 100 < r.rollout_percent
   ORDER BY r.version_code DESC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.firmware_version_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firmware_offer(uuid) FROM PUBLIC, anon, authenticated;

-- The heartbeat also stores the build and where updating stands. Everything
-- else is unchanged from 20261122000006_device_commands.sql.
CREATE OR REPLACE FUNCTION public.device_heartbeat(p_device_id uuid, p_beat jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  command jsonb;
  ack     jsonb := p_beat -> 'command_ack';
  ota     jsonb := CASE WHEN jsonb_typeof(p_beat -> 'ota') = 'object' THEN p_beat -> 'ota' END;
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
    usb_restarts     = coalesce((p_beat->>'usb_restarts')::int, usb_restarts),
    firmware_build   = coalesce(p_beat->>'build', firmware_build),
    -- A beat that carries `ota` describes the whole state: what it omits is
    -- no longer true. Except the rejected version, which only ever moves
    -- forward -- forgetting it would offer the board the version it just
    -- rolled back from.
    ota_updated_at   = CASE WHEN ota IS NOT NULL
                             AND ((ota->>'state') IS DISTINCT FROM ota_state
                                  OR (ota->>'target') IS DISTINCT FROM ota_target_version)
                            THEN now() ELSE ota_updated_at END,
    ota_state        = CASE WHEN ota IS NOT NULL THEN ota->>'state' ELSE ota_state END,
    ota_target_version = CASE WHEN ota IS NOT NULL THEN ota->>'target' ELSE ota_target_version END,
    ota_error        = CASE WHEN ota IS NOT NULL THEN ota->>'error' ELSE ota_error END,
    ota_rejected_version = coalesce(ota->>'rejected', ota_rejected_version)
  WHERE id = p_device_id;

  IF p_beat ? 'free_heap' THEN
    INSERT INTO public.device_health (device_id, uptime_seconds, free_heap, min_heap, queue_size, error_count, rssi, scanner_attached)
         VALUES (p_device_id, (p_beat->>'uptime')::bigint, (p_beat->>'free_heap')::int, (p_beat->>'min_heap')::int,
                 (p_beat->>'queue_size')::int, (p_beat->>'errors')::int, (p_beat->>'rssi')::int,
                 (p_beat->>'scanner_attached')::boolean)
    ON CONFLICT DO NOTHING;
    DELETE FROM public.device_health WHERE device_id = p_device_id AND at < now() - interval '14 days';
  END IF;

  -- The device reports the outcome of a command it ran.
  IF ack IS NOT NULL AND ack ? 'id' THEN
    UPDATE public.device_commands
       SET status  = (CASE WHEN ack->>'status' = 'failed' THEN 'failed' ELSE 'done' END)::public.command_status,
           done_at = now(),
           result  = ack -> 'result'
     WHERE id = (ack->>'id')::uuid AND device_id = p_device_id AND status <> 'done';
  END IF;

  -- A command not picked up in time is dead; it must never run late.
  UPDATE public.device_commands SET status = 'expired'
   WHERE device_id = p_device_id AND status IN ('pending', 'sent') AND expires_at < now();

  -- Hand over exactly one command, and remember it (unchanged behaviour).
  UPDATE public.devices
     SET pending_command = NULL, last_command = pending_command, last_command_sent_at = now()
   WHERE id = p_device_id AND pending_command IS NOT NULL
  RETURNING last_command INTO command;

  -- Mark the delivered command 'sent'; if it had expired meanwhile, do not
  -- deliver it to the device.
  IF command IS NOT NULL AND command ? 'id' THEN
    UPDATE public.device_commands SET status = 'sent', sent_at = now()
     WHERE id = (command->>'id')::uuid AND device_id = p_device_id AND status = 'pending';
    IF NOT FOUND THEN command := NULL; END IF;
  END IF;

  RETURN command;
END
$$;
