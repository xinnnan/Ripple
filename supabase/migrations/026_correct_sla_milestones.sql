-- Migration 026 — Correct SLA milestone semantics and persistence
--
-- PRD v1.1:
--   First Response Time = ticket created -> first human,
--   customer-visible response. Automated acknowledgements, customer replies,
--   internal notes, assignment, and status changes do not qualify.
--
-- This migration:
--   * records independent response/resolution breach timestamps;
--   * repairs historical first-response values from qualifying comments;
--   * compares resolution due time with the actual resolved_at timestamp;
--   * provides row-locked commands that atomically persist the business
--     mutation, ticket timeline, cross-entity audit, and SLA milestone data.
--
-- Apply after 025_archive_lifecycle_and_active_account_guards.sql and before
-- deploying application code that calls these functions.

ALTER TABLE public.ticket_comments
  ADD COLUMN IF NOT EXISTS is_automated boolean NOT NULL DEFAULT false;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS first_response_breached_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_breached_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_first_response_breached
  ON public.tickets (first_response_breached_at)
  WHERE first_response_breached_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_resolution_breached
  ON public.tickets (resolution_breached_at)
  WHERE resolution_breached_at IS NOT NULL;

-- The legacy policies from migrations 010/013 are permissive and therefore
-- OR together. "Users see ticket comments" omitted the visibility predicate,
-- so it unintentionally overrode the older customer-visible policy. The same
-- pattern exposed internal attachments and raw ticket events. Centralize the
-- ticket-scope decision and replace those policies before relying on comment
-- visibility for SLA semantics.
CREATE OR REPLACE FUNCTION public.current_user_can_access_ticket(
  target_ticket_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tickets AS t
    JOIN public.sites AS s
      ON s.id = t.site_id
      AND s.customer_id = t.customer_id
    JOIN public.customers AS c ON c.id = t.customer_id
    JOIN public.users AS u ON u.id = auth.uid()
    WHERE t.id = target_ticket_id
      AND u.status = 'active'
      AND s.status = 'active'
      AND c.status IN ('active', 'trial')
      AND (
        u.role IN ('admin', 'engineer')
        OR (
          u.role = 'customer_manager'
          AND u.customer_id = t.customer_id
        )
        OR (
          u.role = 'customer'
          AND EXISTS (
            SELECT 1
            FROM public.site_members AS sm
            WHERE sm.user_id = u.id
              AND sm.site_id = t.site_id
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_access_ticket(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_ticket(uuid)
  TO authenticated;

DROP POLICY IF EXISTS "Internal users can view all comments"
  ON public.ticket_comments;
DROP POLICY IF EXISTS "Customer users can view customer-visible comments"
  ON public.ticket_comments;
DROP POLICY IF EXISTS "Users see ticket comments"
  ON public.ticket_comments;
DROP POLICY IF EXISTS "Scoped ticket comment visibility"
  ON public.ticket_comments;
CREATE POLICY "Scoped ticket comment visibility"
  ON public.ticket_comments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (
      visibility = 'customer'
      AND (
        SELECT public.current_user_can_access_ticket(ticket_id)
      )
    )
  );

DROP POLICY IF EXISTS "Users see ticket attachments"
  ON public.ticket_attachments;
DROP POLICY IF EXISTS "Scoped ticket attachment visibility"
  ON public.ticket_attachments;
CREATE POLICY "Scoped ticket attachment visibility"
  ON public.ticket_attachments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
    OR (
      visibility = 'customer'
      AND (
        SELECT public.current_user_can_access_ticket(ticket_id)
      )
    )
  );

DROP POLICY IF EXISTS "Users see ticket events"
  ON public.ticket_events;
DROP POLICY IF EXISTS "Internal ticket event visibility"
  ON public.ticket_events;
CREATE POLICY "Internal ticket event visibility"
  ON public.ticket_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.current_user_role()) IN ('admin', 'engineer')
  );

COMMENT ON FUNCTION public.current_user_can_access_ticket(uuid) IS
  'RLS helper for active users. Internal roles can access active tickets;
   customer managers are customer-scoped; customers require an explicit active
   site assignment. SECURITY DEFINER avoids policy recursion.';

-- The following statements repair derived SLA history. They must not make
-- every historical ticket look newly active by advancing updated_at.
ALTER TABLE public.tickets DISABLE TRIGGER update_tickets_updated_at;

-- Repair first_response_at. The previous implementation incorrectly counted
-- internal-only notes and status changes. Existing qualifying comments are
-- authoritative: customer-visible, human, and authored by an internal user.
WITH qualified_response AS (
  SELECT
    tc.ticket_id,
    min(tc.created_at) AS achieved_at
  FROM public.ticket_comments AS tc
  JOIN public.users AS u ON u.id = tc.author_id
  WHERE tc.visibility = 'customer'
    AND tc.is_automated = false
    AND u.role IN ('admin', 'engineer')
  GROUP BY tc.ticket_id
)
UPDATE public.tickets AS t
SET first_response_at = q.achieved_at
FROM qualified_response AS q
WHERE t.id = q.ticket_id
  AND t.first_response_at IS DISTINCT FROM q.achieved_at;

UPDATE public.tickets AS t
SET first_response_at = NULL
WHERE t.first_response_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.ticket_comments AS tc
    JOIN public.users AS u ON u.id = tc.author_id
    WHERE tc.ticket_id = t.id
      AND tc.visibility = 'customer'
      AND tc.is_automated = false
      AND u.role IN ('admin', 'engineer')
  );

-- Older rows can lack resolved_at. Recover it only from an attributable
-- status event; do not invent a timestamp from updated_at.
WITH first_resolution AS (
  SELECT
    te.ticket_id,
    min(te.created_at) AS achieved_at
  FROM public.ticket_events AS te
  WHERE te.event_type IN ('status_changed', 'ticket_resolved')
    AND te.new_value = 'resolved'
  GROUP BY te.ticket_id
)
UPDATE public.tickets AS t
SET resolved_at = r.achieved_at
FROM first_resolution AS r
WHERE t.id = r.ticket_id
  AND t.resolved_at IS NULL
  AND t.status IN ('resolved', 'closed');

-- Backfill milestone-specific breach timestamps. A breach begins at the due
-- time, while achieved_at/resolved_at retains the actual completion time used
-- to decide whether the target was met.
UPDATE public.tickets AS t
SET
  first_response_breached_at = CASE
    WHEN t.first_response_due_at IS NOT NULL
      AND (
        t.first_response_at > t.first_response_due_at
        OR (
          t.first_response_at IS NULL
          AND t.first_response_due_at < pg_catalog.clock_timestamp()
        )
      )
      THEN t.first_response_due_at
    ELSE NULL
  END,
  resolution_breached_at = CASE
    WHEN t.resolve_due_at IS NOT NULL
      AND (
        t.resolved_at > t.resolve_due_at
        OR (
          t.resolved_at IS NULL
          AND t.status NOT IN ('resolved', 'closed')
          AND t.resolve_due_at < pg_catalog.clock_timestamp()
        )
      )
      THEN t.resolve_due_at
    ELSE NULL
  END,
  sla_breached = (
    (
      t.first_response_due_at IS NOT NULL
      AND (
        t.first_response_at > t.first_response_due_at
        OR (
          t.first_response_at IS NULL
          AND t.first_response_due_at < pg_catalog.clock_timestamp()
        )
      )
    )
    OR
    (
      t.resolve_due_at IS NOT NULL
      AND (
        t.resolved_at > t.resolve_due_at
        OR (
          t.resolved_at IS NULL
          AND t.status NOT IN ('resolved', 'closed')
          AND t.resolve_due_at < pg_catalog.clock_timestamp()
        )
      )
    )
  );

INSERT INTO public.audit_logs (
  actor_id,
  actor_email,
  actor_role,
  entity_type,
  entity_id,
  action,
  field_name,
  old_value,
  new_value,
  metadata
)
SELECT
  NULL,
  NULL,
  'system',
  'ticket',
  t.id,
  'updated',
  'sla_history',
  NULL,
  pg_catalog.jsonb_build_object(
    'first_response_at', t.first_response_at,
    'first_response_breached_at', t.first_response_breached_at,
    'resolved_at', t.resolved_at,
    'resolution_breached_at', t.resolution_breached_at,
    'sla_breached', t.sla_breached
  )::text,
  pg_catalog.jsonb_build_object(
    'source', 'migration',
    'migration', '026_correct_sla_milestones',
    'reason', 'PRD v1.1 milestone definition repair'
  )
FROM public.tickets AS t
WHERE t.sla_policy_id IS NOT NULL
   OR t.first_response_at IS NOT NULL
   OR t.resolved_at IS NOT NULL;

ALTER TABLE public.tickets ENABLE TRIGGER update_tickets_updated_at;

CREATE OR REPLACE FUNCTION public.apply_ticket_patch_with_sla(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_patch jsonb,
  p_source text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_after public.tickets%ROWTYPE;
  v_actor_email text;
  v_actor_role text;
  v_occurred_at timestamptz;
  v_new_status text;
  v_new_severity text;
  v_new_owner_id uuid;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_first_breached_at timestamptz;
  v_resolution_breached_at timestamptz;
BEGIN
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Ticket patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Ticket patch must contain at least one field'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
    WHERE supplied.key NOT IN (
      'status',
      'severity',
      'owner_id',
      'customer_visible_summary',
      'internal_summary',
      'root_cause_category',
      'follow_up_needed'
    )
  ) THEN
    RAISE EXCEPTION 'Ticket patch contains an unsupported field'
      USING ERRCODE = '22023';
  END IF;

  IF p_source IS NULL
    OR p_source NOT IN ('web', 'slack', 'email', 'internal')
  THEN
    RAISE EXCEPTION 'Unsupported ticket mutation source'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role
  INTO v_actor_email, v_actor_role
  FROM public.users AS u
  WHERE u.id = p_actor_id
    AND u.status = 'active'
    AND u.role IN ('admin', 'engineer');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active internal account required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sites AS s
    JOIN public.customers AS c ON c.id = s.customer_id
    WHERE s.id = v_ticket.site_id
      AND s.customer_id = v_ticket.customer_id
      AND s.status = 'active'
      AND c.status IN ('active', 'trial')
  ) THEN
    RAISE EXCEPTION 'Archived ticket cannot be mutated'
      USING ERRCODE = '22023';
  END IF;

  -- Take the event timestamp after acquiring the row lock so a waiter cannot
  -- record a milestone before the mutation actually owns the ticket.
  v_occurred_at := pg_catalog.clock_timestamp();

  v_new_status := CASE
    WHEN p_patch ? 'status' THEN p_patch ->> 'status'
    ELSE v_ticket.status
  END;
  IF v_new_status IS NULL OR v_new_status NOT IN (
    'new',
    'assigned',
    'in_progress',
    'waiting_customer',
    'waiting_droplet',
    'resolved',
    'closed',
    'reopened'
  ) THEN
    RAISE EXCEPTION 'Unsupported ticket status'
      USING ERRCODE = '22023';
  END IF;

  v_new_severity := CASE
    WHEN p_patch ? 'severity' THEN p_patch ->> 'severity'
    ELSE v_ticket.severity
  END;
  IF v_new_severity IS NULL
    OR v_new_severity NOT IN ('P1', 'P2', 'P3', 'P4')
  THEN
    RAISE EXCEPTION 'Unsupported ticket severity'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'owner_id' AND p_patch -> 'owner_id' <> 'null'::jsonb THEN
    BEGIN
      v_new_owner_id := (p_patch ->> 'owner_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'owner_id must be a UUID or null'
          USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.users AS owner
      WHERE owner.id = v_new_owner_id
        AND owner.status = 'active'
        AND owner.role IN ('admin', 'engineer')
    ) THEN
      RAISE EXCEPTION 'Ticket owner must be an active internal user'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_patch ? 'owner_id' THEN
    v_new_owner_id := NULL;
  ELSE
    v_new_owner_id := v_ticket.owner_id;
  END IF;

  v_resolved_at := v_ticket.resolved_at;
  IF v_new_status = 'resolved' AND v_ticket.status IS DISTINCT FROM 'resolved' THEN
    v_resolved_at := v_occurred_at;
  END IF;

  v_closed_at := v_ticket.closed_at;
  IF v_new_status = 'closed' AND v_ticket.status IS DISTINCT FROM 'closed' THEN
    v_closed_at := v_occurred_at;
  END IF;

  v_first_breached_at := v_ticket.first_response_breached_at;
  IF v_first_breached_at IS NULL
    AND v_ticket.first_response_due_at IS NOT NULL
    AND (
      v_ticket.first_response_at > v_ticket.first_response_due_at
      OR (
        v_ticket.first_response_at IS NULL
        AND v_ticket.first_response_due_at < v_occurred_at
      )
    )
  THEN
    v_first_breached_at := v_ticket.first_response_due_at;
  END IF;

  v_resolution_breached_at := v_ticket.resolution_breached_at;
  IF v_resolution_breached_at IS NULL
    AND v_ticket.resolve_due_at IS NOT NULL
    AND (
      v_resolved_at > v_ticket.resolve_due_at
      OR (
        v_resolved_at IS NULL
        AND v_new_status NOT IN ('resolved', 'closed')
        AND v_ticket.resolve_due_at < v_occurred_at
      )
    )
  THEN
    v_resolution_breached_at := v_ticket.resolve_due_at;
  END IF;

  UPDATE public.tickets AS t
  SET
    status = v_new_status,
    severity = v_new_severity,
    owner_id = v_new_owner_id,
    customer_visible_summary = CASE
      WHEN p_patch ? 'customer_visible_summary'
        THEN p_patch ->> 'customer_visible_summary'
      ELSE v_ticket.customer_visible_summary
    END,
    internal_summary = CASE
      WHEN p_patch ? 'internal_summary' THEN p_patch ->> 'internal_summary'
      ELSE v_ticket.internal_summary
    END,
    root_cause_category = CASE
      WHEN p_patch ? 'root_cause_category'
        THEN p_patch ->> 'root_cause_category'
      ELSE v_ticket.root_cause_category
    END,
    follow_up_needed = CASE
      WHEN p_patch ? 'follow_up_needed'
        THEN COALESCE((p_patch ->> 'follow_up_needed')::boolean, false)
      ELSE v_ticket.follow_up_needed
    END,
    resolved_at = v_resolved_at,
    closed_at = v_closed_at,
    first_response_breached_at = v_first_breached_at,
    resolution_breached_at = v_resolution_breached_at,
    sla_breached = (
      v_ticket.sla_breached
      OR v_first_breached_at IS NOT NULL
      OR v_resolution_breached_at IS NOT NULL
    )
  WHERE t.id = v_ticket.id
  RETURNING t.* INTO v_after;

  INSERT INTO public.ticket_events (
    ticket_id,
    event_type,
    old_value,
    new_value,
    actor_id,
    created_at
  )
  SELECT
    v_ticket.id,
    change.event_type,
    change.old_value,
    change.new_value,
    p_actor_id,
    v_occurred_at
  FROM (
    VALUES
      (
        'status_changed'::text,
        v_ticket.status::text,
        v_after.status::text
      ),
      (
        'severity_changed'::text,
        v_ticket.severity::text,
        v_after.severity::text
      ),
      (
        'owner_assigned'::text,
        v_ticket.owner_id::text,
        v_after.owner_id::text
      )
  ) AS change(event_type, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    field_name,
    old_value,
    new_value,
    metadata,
    created_at
  )
  SELECT
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'ticket',
    v_ticket.id,
    change.action,
    change.field_name,
    change.old_value,
    change.new_value,
    pg_catalog.jsonb_build_object(
      'source', p_source,
      'command', 'apply_ticket_patch_with_sla'
    ),
    v_occurred_at
  FROM (
    VALUES
      (
        'status_changed'::text,
        'status'::text,
        v_ticket.status::text,
        v_after.status::text
      ),
      (
        'severity_changed'::text,
        'severity'::text,
        v_ticket.severity::text,
        v_after.severity::text
      ),
      (
        'owner_assigned'::text,
        'owner_id'::text,
        v_ticket.owner_id::text,
        v_after.owner_id::text
      ),
      (
        'updated'::text,
        'customer_visible_summary'::text,
        v_ticket.customer_visible_summary,
        v_after.customer_visible_summary
      ),
      (
        'updated'::text,
        'internal_summary'::text,
        v_ticket.internal_summary,
        v_after.internal_summary
      ),
      (
        'updated'::text,
        'root_cause_category'::text,
        v_ticket.root_cause_category,
        v_after.root_cause_category
      ),
      (
        'updated'::text,
        'follow_up_needed'::text,
        v_ticket.follow_up_needed::text,
        v_after.follow_up_needed::text
      )
  ) AS change(action, field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;

  IF v_new_status = 'resolved'
    AND v_ticket.status IS DISTINCT FROM 'resolved'
  THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_resolution_achieved',
      v_ticket.resolve_due_at::text,
      v_resolved_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  IF v_ticket.first_response_breached_at IS NULL
    AND v_first_breached_at IS NOT NULL
  THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_first_response_breached',
      v_ticket.first_response_due_at::text,
      v_occurred_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  IF v_ticket.resolution_breached_at IS NULL
    AND v_resolution_breached_at IS NOT NULL
  THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_resolution_breached',
      v_ticket.resolve_due_at::text,
      v_occurred_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  RETURN v_ticket.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ticket_comment_with_sla(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_body text,
  p_visibility text,
  p_source text,
  p_is_automated boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_actor_email text;
  v_actor_role text;
  v_actor_customer_id uuid;
  v_comment_id uuid;
  v_occurred_at timestamptz;
  v_first_response_at timestamptz;
  v_first_breached_at timestamptz;
  v_resolution_breached_at timestamptz;
  v_qualifies_as_response boolean;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) < 1 OR length(p_body) > 10000 THEN
    RAISE EXCEPTION 'Comment body must contain 1 to 10000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_visibility IS NULL
    OR p_visibility NOT IN ('customer', 'internal')
  THEN
    RAISE EXCEPTION 'Unsupported comment visibility'
      USING ERRCODE = '22023';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('web', 'slack', 'email') THEN
    RAISE EXCEPTION 'Unsupported comment source'
      USING ERRCODE = '22023';
  END IF;

  IF p_is_automated IS NULL THEN
    RAISE EXCEPTION 'Comment automation flag is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.role, u.customer_id
  INTO v_actor_email, v_actor_role, v_actor_customer_id
  FROM public.users AS u
  WHERE u.id = p_actor_id
    AND u.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active user account required'
      USING ERRCODE = '42501';
  END IF;

  IF p_visibility = 'internal'
    AND v_actor_role NOT IN ('admin', 'engineer')
  THEN
    RAISE EXCEPTION 'Internal comments require an internal account'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sites AS s
    JOIN public.customers AS c ON c.id = s.customer_id
    WHERE s.id = v_ticket.site_id
      AND s.customer_id = v_ticket.customer_id
      AND s.status = 'active'
      AND c.status IN ('active', 'trial')
  ) THEN
    RAISE EXCEPTION 'Archived ticket cannot receive comments'
      USING ERRCODE = '22023';
  END IF;

  IF v_actor_role = 'customer_manager'
    AND v_actor_customer_id IS DISTINCT FROM v_ticket.customer_id
  THEN
    RAISE EXCEPTION 'Ticket is outside the customer account'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'customer'
    AND NOT EXISTS (
      SELECT 1
      FROM public.site_members AS sm
      WHERE sm.user_id = p_actor_id
        AND sm.site_id = v_ticket.site_id
    )
  THEN
    RAISE EXCEPTION 'Ticket is outside the assigned sites'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN (
    'admin',
    'engineer',
    'customer_manager',
    'customer'
  ) THEN
    RAISE EXCEPTION 'Unsupported comment author role'
      USING ERRCODE = '42501';
  END IF;

  v_occurred_at := pg_catalog.clock_timestamp();
  v_qualifies_as_response := (
    v_ticket.first_response_at IS NULL
    AND v_actor_role IN ('admin', 'engineer')
    AND p_visibility = 'customer'
    AND p_is_automated = false
  );
  v_first_response_at := CASE
    WHEN v_qualifies_as_response THEN v_occurred_at
    ELSE v_ticket.first_response_at
  END;

  v_first_breached_at := v_ticket.first_response_breached_at;
  IF v_first_breached_at IS NULL
    AND v_ticket.first_response_due_at IS NOT NULL
    AND (
      v_first_response_at > v_ticket.first_response_due_at
      OR (
        v_first_response_at IS NULL
        AND v_ticket.first_response_due_at < v_occurred_at
      )
    )
  THEN
    v_first_breached_at := v_ticket.first_response_due_at;
  END IF;

  v_resolution_breached_at := v_ticket.resolution_breached_at;
  IF v_resolution_breached_at IS NULL
    AND v_ticket.resolve_due_at IS NOT NULL
    AND v_ticket.resolved_at IS NULL
    AND v_ticket.status NOT IN ('resolved', 'closed')
    AND v_ticket.resolve_due_at < v_occurred_at
  THEN
    v_resolution_breached_at := v_ticket.resolve_due_at;
  END IF;

  INSERT INTO public.ticket_comments (
    ticket_id,
    author_id,
    body,
    visibility,
    source,
    is_automated,
    created_at
  )
  VALUES (
    v_ticket.id,
    p_actor_id,
    p_body,
    p_visibility,
    p_source,
    p_is_automated,
    v_occurred_at
  )
  RETURNING id INTO v_comment_id;

  INSERT INTO public.ticket_events (
    ticket_id,
    event_type,
    old_value,
    new_value,
    actor_id,
    created_at
  )
  VALUES (
    v_ticket.id,
    'comment_added',
    NULL,
    p_visibility,
    p_actor_id,
    v_occurred_at
  );

  INSERT INTO public.audit_logs (
    actor_id,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    action,
    field_name,
    old_value,
    new_value,
    metadata,
    created_at
  )
  VALUES (
    p_actor_id,
    v_actor_email,
    v_actor_role,
    'comment',
    v_comment_id,
    'created',
    'ticket_id',
    NULL,
    v_ticket.id::text,
    pg_catalog.jsonb_build_object(
      'source', p_source,
      'visibility', p_visibility,
      'is_automated', p_is_automated
    ),
    v_occurred_at
  );

  IF v_qualifies_as_response
    OR v_first_breached_at IS DISTINCT FROM v_ticket.first_response_breached_at
    OR v_resolution_breached_at IS DISTINCT FROM v_ticket.resolution_breached_at
  THEN
    UPDATE public.tickets AS t
    SET
      first_response_at = v_first_response_at,
      first_response_breached_at = v_first_breached_at,
      resolution_breached_at = v_resolution_breached_at,
      sla_breached = (
        v_ticket.sla_breached
        OR v_first_breached_at IS NOT NULL
        OR v_resolution_breached_at IS NOT NULL
      )
    WHERE t.id = v_ticket.id;
  END IF;

  IF v_qualifies_as_response THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_first_response_achieved',
      v_ticket.first_response_due_at::text,
      v_occurred_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  IF v_ticket.first_response_breached_at IS NULL
    AND v_first_breached_at IS NOT NULL
  THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_first_response_breached',
      v_ticket.first_response_due_at::text,
      v_occurred_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  IF v_ticket.resolution_breached_at IS NULL
    AND v_resolution_breached_at IS NOT NULL
  THEN
    INSERT INTO public.ticket_events (
      ticket_id,
      event_type,
      old_value,
      new_value,
      actor_id,
      created_at
    )
    VALUES (
      v_ticket.id,
      'sla_resolution_breached',
      v_ticket.resolve_due_at::text,
      v_occurred_at::text,
      p_actor_id,
      v_occurred_at
    );
  END IF;

  RETURN v_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ticket_patch_with_sla(
  uuid,
  uuid,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_ticket_comment_with_sla(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_ticket_patch_with_sla(
  uuid,
  uuid,
  jsonb,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_ticket_comment_with_sla(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean
) TO service_role;

COMMENT ON COLUMN public.ticket_comments.is_automated IS
  'True for system-generated messages. Automated messages never satisfy the
   First Human Response milestone.';

COMMENT ON COLUMN public.tickets.first_response_breached_at IS
  'Timestamp at which the first-human-response SLA crossed its due time.';

COMMENT ON COLUMN public.tickets.resolution_breached_at IS
  'Timestamp at which the resolution SLA crossed its due time.';

COMMENT ON FUNCTION public.apply_ticket_patch_with_sla(
  uuid,
  uuid,
  jsonb,
  text
) IS
  'Service-role-only, row-locked ticket mutation command. It persists actual
   resolution time, milestone-specific breaches, ticket events, and audit rows
   in one transaction. Status changes never count as first human response.';

COMMENT ON FUNCTION public.record_ticket_comment_with_sla(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean
) IS
  'Service-role-only, row-locked comment command. Only the first human,
   internal-authored, customer-visible, non-automated comment achieves First
   Response; comment, audit, and SLA records commit atomically.';
