-- Optimistic concurrency for gap_windows JSONB updates (Functional Spec §7).
-- DD v0.3 does not mandate a row-level bump field; adding updated_at preserves
-- the read–compare–write pattern without ambiguity.

ALTER TABLE public.sl_provider_records
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now ();

CREATE OR REPLACE FUNCTION public.sl_spr_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now ();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spr_updated_at ON public.sl_provider_records;

CREATE TRIGGER trg_spr_updated_at
  BEFORE UPDATE ON public.sl_provider_records
  FOR EACH ROW
  EXECUTE FUNCTION public.sl_spr_touch_updated_at ();

COMMENT ON COLUMN public.sl_provider_records.updated_at IS
  'Bump on UPDATE for optimistic locking of gap_windows mutations (FS §7).';
