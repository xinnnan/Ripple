-- Migration 046 — Durable public request throttling
--
-- Process-local counters reset across serverless instances and cold starts.
-- Keep a small, opaque, service-owned bucket table and an atomic command so
-- public boundary limits remain effective across instances. Callers hash the
-- purpose + client address before invoking the command; raw addresses are not
-- persisted. Expired rows are pruned opportunistically with a bounded batch.

BEGIN;

CREATE TABLE public.request_rate_limits (
  bucket_key text PRIMARY KEY,
  request_count integer NOT NULL,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT request_rate_limits_bucket_key_shape
    CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT request_rate_limits_request_count_nonnegative
    CHECK (request_count >= 0)
);

CREATE INDEX request_rate_limits_reset_at_idx
  ON public.request_rate_limits (reset_at);

ALTER TABLE public.request_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.request_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.request_rate_limits
  TO service_role;

CREATE OR REPLACE FUNCTION public.consume_request_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_count integer;
  v_reset_at timestamptz;
BEGIN
  IF p_bucket_key IS NULL
    OR p_bucket_key !~ '^[0-9a-f]{64}$'
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 10000
    OR p_window_seconds IS NULL
    OR p_window_seconds NOT BETWEEN 1 AND 86400
  THEN
    RAISE EXCEPTION 'Rate-limit input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Bound retained state without requiring a second cron dependency.
  DELETE FROM public.request_rate_limits
  WHERE bucket_key IN (
    SELECT expired.bucket_key
    FROM public.request_rate_limits AS expired
    WHERE expired.reset_at < v_now - interval '24 hours'
    ORDER BY expired.reset_at
    LIMIT 100
  );

  INSERT INTO public.request_rate_limits AS bucket (
    bucket_key,
    request_count,
    reset_at,
    updated_at
  )
  VALUES (
    p_bucket_key,
    1,
    v_now + (p_window_seconds * interval '1 second'),
    v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    request_count = CASE
      WHEN bucket.reset_at <= v_now THEN 1
      ELSE LEAST(bucket.request_count + 1, p_limit + 1)
    END,
    reset_at = CASE
      WHEN bucket.reset_at <= v_now
        THEN v_now + (p_window_seconds * interval '1 second')
      ELSE bucket.reset_at
    END,
    updated_at = v_now
  RETURNING bucket.request_count, bucket.reset_at
  INTO v_request_count, v_reset_at;

  RETURN QUERY
  SELECT
    v_request_count <= p_limit,
    GREATEST(p_limit - v_request_count, 0),
    v_reset_at;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_request_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_request_rate_limit(text, integer, integer)
  TO service_role;

COMMENT ON TABLE public.request_rate_limits IS
  'Opaque, short-lived counters for distributed throttling at public HTTP boundaries.';
COMMENT ON FUNCTION public.consume_request_rate_limit(text, integer, integer) IS
  'Atomically consumes an opaque rate-limit bucket; service role only.';

COMMIT;
