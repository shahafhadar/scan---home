-- Reliable remote commands over the existing HTTPS pull. A command gets its own
-- id and a lifecycle -- pending -> sent -> done/failed, or expired -- so the app
-- can show what really happened (received vs executed vs confirmed), a command
-- runs at most once (the id dedups), and a stale command is never executed.
-- No broker: the device still picks the command up on its next heartbeat and
-- reports the result on the one after.

CREATE TYPE public.command_status AS ENUM ('pending', 'sent', 'done', 'failed', 'expired');

CREATE TABLE public.device_commands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     public.command_status NOT NULL DEFAULT 'pending',
  result     jsonb,
  issued_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  done_at    timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX device_commands_device ON public.device_commands (device_id, created_at DESC);

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
-- Members of the device's household can watch their commands' status.
CREATE POLICY "members read device commands" ON public.device_commands
  FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.devices WHERE household_id IN (SELECT public.my_household_ids())));
-- No direct writes: issuing and acking go through the functions below.
REVOKE ALL ON public.device_commands FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.device_commands FROM authenticated;

-- Queue a command for a device. Only an active member of the device's household
-- may issue, and a viewer may not. Returns the command id.
CREATE FUNCTION public.issue_device_command(
  p_device_id uuid,
  p_type      text,
  p_payload   jsonb DEFAULT '{}'::jsonb,
  p_ttl       interval DEFAULT interval '2 minutes'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cmd_id  uuid := gen_random_uuid();
  dev     public.devices%ROWTYPE;
  my_role public.member_role;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE id = p_device_id;
  IF NOT FOUND OR dev.household_id IS NULL THEN
    RAISE EXCEPTION 'device not found' USING ERRCODE = '42704';
  END IF;

  SELECT role INTO my_role FROM public.household_members
   WHERE household_id = dev.household_id AND user_id = auth.uid();
  IF my_role IS NULL THEN
    RAISE EXCEPTION 'not a member of this device''s household' USING ERRCODE = '42501';
  END IF;
  IF my_role = 'viewer' THEN
    RAISE EXCEPTION 'viewers cannot send commands' USING ERRCODE = '42501';
  END IF;
  IF p_type NOT IN ('locate', 'reboot', 'factory_reset', 'reprovision') THEN
    RAISE EXCEPTION 'unknown command %', p_type;
  END IF;

  -- A new command supersedes one still waiting to be picked up.
  UPDATE public.device_commands SET status = 'expired'
   WHERE device_id = p_device_id AND status = 'pending';

  INSERT INTO public.device_commands (id, device_id, type, payload, status, expires_at, issued_by)
       VALUES (cmd_id, p_device_id, p_type, coalesce(p_payload, '{}'::jsonb), 'pending', now() + p_ttl, auth.uid());

  -- Hand-off blob for the heartbeat. `action` is the field the firmware reads.
  UPDATE public.devices
     SET pending_command = jsonb_build_object('id', cmd_id, 'action', p_type, 'payload', coalesce(p_payload, '{}'::jsonb))
   WHERE id = p_device_id;

  RETURN cmd_id;
END
$$;
REVOKE ALL ON FUNCTION public.issue_device_command(uuid, text, jsonb, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_device_command(uuid, text, jsonb, interval) TO authenticated;

-- Extend the heartbeat to drive the command lifecycle: record an ack the device
-- sent for a command it ran, expire stale commands, and mark the one handed out
-- this beat as 'sent' (and never hand out an already-expired one). Everything
-- else is unchanged from the init migration.
CREATE OR REPLACE FUNCTION public.device_heartbeat(p_device_id uuid, p_beat jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  command jsonb;
  ack     jsonb := p_beat -> 'command_ack';
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
