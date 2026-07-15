-- Migration 020 — Replace racy MAX+1 ticket numbering with sequences
--
-- Why:
--   `src/lib/tickets/create.ts:generateNextTicketNo()` currently does
--   `SELECT MAX(ticket_no) + 1`. Under concurrent ticket creation
--   two requests can read the same max, both try to insert the
--   same ticket_no, and one fails on the UNIQUE constraint.
--   Acceptable at current DropletAI volume (low), but a real bug
--   waiting to happen.
--
-- Fix:
--   - Add three Postgres sequences (ticket_no_seq, request_no_seq,
--     order_no_seq). Each starts at 1 and the API formats the
--     next value into the existing `RPL-XXXXXX` / `SPR-XXXX` /
--     `FSO-XXXX` shape.
--   - Set the sequences' initial value to `MAX(current_number) + 1`
--     so we don't collide with tickets already in the DB.
--   - Keep the ticket_no / request_no / order_no columns as TEXT
--     (their existing shape) — the format may want to grow
--     (year prefix, per-customer prefix, etc.) and a TEXT column
--     keeps the formatting concern in the API layer.
--
-- The application code change is in src/lib/tickets/create.ts
-- (and the equivalent helpers for spare parts + field service
-- orders). This migration just sets up the sequences.

-- ---------------------------------------------------------------------------
-- Ticket number sequence: RPL-XXXXXX (6-digit zero-padded)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.ticket_no_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- Seed it from the existing max so the next ticket picks up
-- after the last one. We strip the "RPL-" prefix and parse the
-- integer; if no tickets exist yet, the start-with-1 above wins.
DO $$
DECLARE
  current_max integer;
BEGIN
  SELECT COALESCE(MAX(CAST(substring(ticket_no FROM 5) AS integer)), 0)
    INTO current_max
    FROM public.tickets
   WHERE ticket_no ~ '^RPL-[0-9]+$';

  IF current_max > 0 THEN
    EXECUTE format('ALTER SEQUENCE public.ticket_no_seq RESTART WITH %s',
                   current_max + 1);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Spare part request number: SPR-XXXX (4-digit)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.request_no_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

DO $$
DECLARE
  current_max integer;
BEGIN
  SELECT COALESCE(MAX(CAST(substring(request_no FROM 5) AS integer)), 0)
    INTO current_max
    FROM public.spare_part_requests
   WHERE request_no ~ '^SPR-[0-9]+$';

  IF current_max > 0 THEN
    EXECUTE format('ALTER SEQUENCE public.request_no_seq RESTART WITH %s',
                   current_max + 1);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Field service order number: FSO-XXXX (4-digit)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.order_no_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

DO $$
DECLARE
  current_max integer;
BEGIN
  SELECT COALESCE(MAX(CAST(substring(order_no FROM 5) AS integer)), 0)
    INTO current_max
    FROM public.field_service_orders
   WHERE order_no ~ '^FSO-[0-9]+$';

  IF current_max > 0 THEN
    EXECUTE format('ALTER SEQUENCE public.order_no_seq RESTART WITH %s',
                   current_max + 1);
  END IF;
END
$$;

COMMENT ON SEQUENCE public.ticket_no_seq IS
  'Source of truth for the numeric part of tickets.ticket_no. The API
   layer formats nextval() into RPL-XXXXXX. Pre-Sprint-3 the code
   used SELECT MAX(ticket_no)+1, which races under concurrency.';

COMMENT ON SEQUENCE public.request_no_seq IS
  'Same idea for spare_part_requests.request_no → SPR-XXXX.';

COMMENT ON SEQUENCE public.order_no_seq IS
  'Same idea for field_service_orders.order_no → FSO-XXXX.';

-- ---------------------------------------------------------------------------
-- Helper RPC: next ticket number, formatted.
-- ---------------------------------------------------------------------------
-- The API calls this instead of doing a SELECT MAX+1. We use an
-- RPC because the supabase-js client cannot do
-- `SELECT nextval('...')` from a SELECT — it has to be inside an
-- RPC or a function. Keeping it as a function lets the API code
-- be one line: `supabase.rpc('next_ticket_no')`.
--
-- `SECURITY DEFINER` so the sequence is accessible regardless of
-- the caller's role; the function is `STABLE` so the planner can
-- cache the result within a single transaction (we only call it
-- once per ticket create).

CREATE OR REPLACE FUNCTION public.next_ticket_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN 'RPL-' || lpad(nextval('public.ticket_no_seq')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_request_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN 'SPR-' || lpad(nextval('public.request_no_seq')::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_order_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN 'FSO-' || lpad(nextval('public.order_no_seq')::text, 4, '0');
END;
$$;

-- Make the functions callable by anyone with the service role
-- (the API uses createAdminClient which has the service role).
-- We deliberately do NOT grant to anon/authenticated — only the
-- server-side API should be minting numbers.
GRANT EXECUTE ON FUNCTION public.next_ticket_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_request_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_order_no() TO service_role;

COMMENT ON FUNCTION public.next_ticket_no() IS
  'Returns the next RPL-XXXXXX ticket number. Backed by
   public.ticket_no_seq. Replaces the racy SELECT MAX+1 logic.';

COMMENT ON FUNCTION public.next_request_no() IS
  'Returns the next SPR-XXXX spare part request number.';

COMMENT ON FUNCTION public.next_order_no() IS
  'Returns the next FSO-XXXX field service order number.';
