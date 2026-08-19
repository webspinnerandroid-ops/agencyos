-- 089 — lock increment_usage to service_role + tenant guard
-- Previously this SECURITY DEFINER function was EXECUTE-granted to PUBLIC by
-- default, so any anonymous/authenticated client could call it with an
-- arbitrary p_tenant_id (and negative p_amount) to tamper with any tenant's
-- usage counters, bypassing RLS. Restrict it to service_role and add a
-- belt-and-suspenders tenant match for non-service-role callers.
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_tenant_id UUID,
  p_metric    TEXT,
  p_amount    INTEGER DEFAULT 1
) RETURNS VOID AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_claims       TEXT;
BEGIN
  -- Non-service-role callers (if ever re-granted) may only touch their own
  -- tenant. service_role requests carry no tenant_id claim, so they pass.
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL AND v_claims <> '' THEN
    IF (v_claims::jsonb ->> 'tenant_id') IS NOT NULL
       AND (v_claims::jsonb ->> 'tenant_id') <> p_tenant_id::text THEN
      RAISE EXCEPTION 'tenant_id mismatch' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_period_start := date_trunc('month', now());

  INSERT INTO tenant_usage (tenant_id, metric, count, period_start)
  VALUES (p_tenant_id, p_metric, p_amount, v_period_start)
  ON CONFLICT (tenant_id, metric, period_start)
  DO UPDATE SET count = tenant_usage.count + EXCLUDED.count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.increment_usage(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_usage(UUID, TEXT, INTEGER) TO service_role;
