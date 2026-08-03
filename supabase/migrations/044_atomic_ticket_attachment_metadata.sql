-- Migration 044 — Atomic ticket-attachment metadata and timeline evidence
--
-- Storage is an external side effect, but the attachment row and its ticket
-- timeline event are one database fact. The upload route now writes the object
-- first, calls this command, and removes the object after a confirmed database
-- rollback. Existing attachment metadata was audited before rollout: all eight
-- rows satisfy the constraints below and storage paths are unique.

BEGIN;

ALTER TABLE public.ticket_attachments
  ADD CONSTRAINT ticket_attachments_file_name_shape
    CHECK (
      file_name = pg_catalog.btrim(file_name)
      AND pg_catalog.char_length(file_name) BETWEEN 3 AND 255
      AND file_name !~ '[[:cntrl:]/\\]'
      AND pg_catalog.strpos(file_name, '..') = 0
    ),
  ADD CONSTRAINT ticket_attachments_file_type_allowed
    CHECK (
      file_type IN (
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/quicktime',
        'application/pdf',
        'text/plain',
        'text/csv',
        'text/log',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      )
    ),
  ADD CONSTRAINT ticket_attachments_file_size_bounds
    CHECK (file_size BETWEEN 1 AND 52428800),
  ADD CONSTRAINT ticket_attachments_storage_path_shape
    CHECK (
      storage_path = pg_catalog.btrim(storage_path)
      AND pg_catalog.char_length(storage_path) BETWEEN 1 AND 1000
      AND storage_path LIKE 'attachments/%'
      AND storage_path !~ '[[:cntrl:]]'
      AND pg_catalog.strpos(storage_path, '//') = 0
      AND pg_catalog.strpos(storage_path, '/../') = 0
    );

CREATE UNIQUE INDEX ticket_attachments_storage_path_unique
  ON public.ticket_attachments (storage_path);

CREATE OR REPLACE FUNCTION public.create_ticket_attachment_atomic(
  p_ticket_id uuid,
  p_uploaded_by uuid,
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_customer_id uuid;
  v_ticket_site_id uuid;
  v_site_status text;
  v_actor_role text;
  v_actor_customer_id uuid;
  v_file_name text;
  v_file_type text;
  v_file_size_numeric numeric;
  v_file_size bigint;
  v_storage_path text;
  v_visibility text;
  v_path_parts text[];
  v_attachment public.ticket_attachments%ROWTYPE;
  v_allowed_fields constant text[] := ARRAY[
    'file_name', 'file_type', 'file_size', 'storage_path', 'visibility'
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71618044001::bigint);

  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'Ticket id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input) <> 'object'
    OR NOT (p_input ?& v_allowed_fields)
    OR (p_input - v_allowed_fields) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'Attachment input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_input -> 'file_name') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'file_type') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'file_size') <> 'number'
    OR pg_catalog.jsonb_typeof(p_input -> 'storage_path') <> 'string'
    OR pg_catalog.jsonb_typeof(p_input -> 'visibility') <> 'string'
  THEN
    RAISE EXCEPTION 'Attachment field type is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_file_name := p_input ->> 'file_name';
  v_file_type := p_input ->> 'file_type';
  v_storage_path := p_input ->> 'storage_path';
  v_visibility := p_input ->> 'visibility';
  BEGIN
    v_file_size_numeric := (p_input ->> 'file_size')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Attachment file size is invalid'
        USING ERRCODE = '22023';
  END;

  IF v_file_name IS NULL
    OR v_file_name <> pg_catalog.btrim(v_file_name)
    OR pg_catalog.char_length(v_file_name) NOT BETWEEN 3 AND 255
    OR v_file_name ~ '[[:cntrl:]/\\]'
    OR pg_catalog.strpos(v_file_name, '..') > 0
    OR v_file_type NOT IN (
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    )
    OR v_file_size_numeric IS NULL
    OR v_file_size_numeric <> pg_catalog.trunc(v_file_size_numeric)
    OR v_file_size_numeric < 1
    OR v_file_size_numeric > 52428800
    OR v_storage_path IS NULL
    OR v_storage_path <> pg_catalog.btrim(v_storage_path)
    OR pg_catalog.char_length(v_storage_path) NOT BETWEEN 1 AND 1000
    OR v_visibility NOT IN ('customer', 'internal')
  THEN
    RAISE EXCEPTION 'Attachment values are invalid'
      USING ERRCODE = '22023';
  END IF;
  v_file_size := v_file_size_numeric::bigint;

  SELECT
    ticket.customer_id,
    ticket.site_id,
    site.status
  INTO
    v_ticket_customer_id,
    v_ticket_site_id,
    v_site_status
  FROM public.tickets AS ticket
  JOIN public.sites AS site ON site.id = ticket.site_id
  JOIN public.customers AS customer ON customer.id = ticket.customer_id
  WHERE ticket.id = p_ticket_id
    AND site.customer_id = ticket.customer_id
    AND site.status IN ('active', 'commissioning')
    AND customer.status IN ('active', 'trial')
  FOR SHARE OF ticket, site, customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active ticket tenant is required'
      USING ERRCODE = '55000';
  END IF;

  v_path_parts := pg_catalog.string_to_array(v_storage_path, '/');
  IF pg_catalog.cardinality(v_path_parts) <> 5
    OR v_path_parts[1] <> 'attachments'
    OR v_path_parts[2] !~ '^[a-z0-9_-]{1,32}$'
    OR v_path_parts[3] <> v_ticket_customer_id::text
    OR v_path_parts[4] <> p_ticket_id::text
    OR v_path_parts[5] = ''
    OR pg_catalog.char_length(v_path_parts[5]) > 300
    OR v_storage_path ~ '[[:cntrl:]]'
    OR pg_catalog.strpos(v_storage_path, '//') > 0
    OR pg_catalog.strpos(v_storage_path, '/../') > 0
  THEN
    RAISE EXCEPTION 'Attachment storage path is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_uploaded_by IS NULL THEN
    IF v_visibility <> 'customer' OR v_site_status <> 'active' THEN
      RAISE EXCEPTION 'Guest attachments must be customer-visible on active sites'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT actor.role, actor.customer_id
    INTO v_actor_role, v_actor_customer_id
    FROM public.users AS actor
    WHERE actor.id = p_uploaded_by
      AND actor.status = 'active'
    FOR SHARE OF actor;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active uploader is required'
        USING ERRCODE = '42501';
    END IF;

    IF v_actor_role IN ('admin', 'engineer') THEN
      NULL;
    ELSIF v_site_status <> 'active' THEN
      RAISE EXCEPTION 'Customer uploads require an active site'
        USING ERRCODE = '42501';
    ELSIF v_actor_role = 'customer_manager'
      AND v_actor_customer_id = v_ticket_customer_id
    THEN
      NULL;
    ELSIF v_actor_role = 'customer'
      AND EXISTS (
        SELECT 1
        FROM public.site_members AS membership
        WHERE membership.user_id = p_uploaded_by
          AND membership.site_id = v_ticket_site_id
        FOR SHARE OF membership
      )
    THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Uploader cannot access this ticket'
        USING ERRCODE = '42501';
    END IF;

    IF v_visibility = 'internal'
      AND v_actor_role NOT IN ('admin', 'engineer')
    THEN
      RAISE EXCEPTION 'Only internal users can add internal attachments'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.ticket_attachments (
    ticket_id,
    uploaded_by,
    file_name,
    file_type,
    file_size,
    storage_path,
    visibility
  )
  VALUES (
    p_ticket_id,
    p_uploaded_by,
    v_file_name,
    v_file_type,
    v_file_size,
    v_storage_path,
    v_visibility
  )
  RETURNING * INTO v_attachment;

  INSERT INTO public.ticket_events (
    ticket_id,
    event_type,
    old_value,
    new_value,
    actor_id
  )
  VALUES (
    p_ticket_id,
    'attachment_added',
    NULL,
    v_file_name,
    p_uploaded_by
  );

  RETURN pg_catalog.to_jsonb(v_attachment);
END;
$$;

REVOKE ALL ON FUNCTION public.create_ticket_attachment_atomic(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_attachment_atomic(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_ticket_attachment_atomic(uuid, uuid, jsonb) IS
  'Validates uploader scope and creates attachment metadata plus timeline evidence atomically after Storage upload.';

COMMIT;
