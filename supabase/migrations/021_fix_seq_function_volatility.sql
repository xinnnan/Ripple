-- Migration 021 — Fix ticket/request/order sequence RPC volatility
--
-- Why:
--   Migration 020 created the three number-minting RPCs
--   (next_ticket_no, next_request_no, next_order_no) with
--   VOLATILITY = STABLE. PostgREST runs RPCs in a read-only
--   transaction by default, and `nextval('seq')` is a write —
--   so the call fails with:
--     "cannot execute nextval() in a read-only transaction"
--   (SQLSTATE 25006). The app falls back to the racy MAX+1
--   path with a warning. Verified 2026-07-18.
--
-- Fix:
--   Mark the functions VOLATILE (PostgREST opens a writable
--   transaction for volatile functions) and add SET search_path
--   for safety.
--
-- Apply via Supabase SQL editor.

ALTER FUNCTION public.next_ticket_no() VOLATILE;
ALTER FUNCTION public.next_request_no() VOLATILE;
ALTER FUNCTION public.next_order_no() VOLATILE;

-- Also set a safe search_path so a malicious schema rewrite can't
-- shadow the sequence name.
ALTER FUNCTION public.next_ticket_no() SET search_path = public;
ALTER FUNCTION public.next_request_no() SET search_path = public;
ALTER FUNCTION public.next_order_no() SET search_path = public;

COMMENT ON FUNCTION public.next_ticket_no() IS
  'Returns the next RPL-XXXXXX ticket number. Backed by
   public.ticket_no_seq. VOLATILE (not STABLE) so PostgREST runs
   the call in a writable transaction and nextval() is allowed.';

COMMENT ON FUNCTION public.next_request_no() IS
  'Returns the next SPR-XXXX spare part request number. VOLATILE.';

COMMENT ON FUNCTION public.next_order_no() IS
  'Returns the next FSO-XXXX field service order number. VOLATILE.';
