-- ============================================================================
-- Migration: 075_bilbo_brand_designer
-- Description:
--   Adds Bilbo — Lead Brand & Vector Graphic Designer — to the AI employee
--   catalog and hires him for every existing tenant (same backfill pattern as
--   migration 019). Persona details live in src/lib/ai/employee-personas.ts
--   (key: bilbo); this row is what makes him appear in the AI Team roster.
-- ============================================================================

INSERT INTO ai_employees (key, name, role, description, status, integrations, settings_href, icon, sort_order)
VALUES (
  'bilbo',
  'Bilbo',
  'Lead Brand & Vector Graphic Designer',
  'Crafts high-resolution logos, vector assets, and brand guidelines with precise, digital accuracy. Deeply pretentious, perpetually wearing a beret, and constantly whining about file formats, kerning, and color profiles while quietly keeping your entire visual identity from falling apart.',
  'built',
  'Brand & Vector Design page, AI image models (Recraft, FLUX, Nano Banana, GPT Image, Kling)',
  '/dashboard/brand-design',
  'Palette',
  12
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  integrations = EXCLUDED.integrations,
  settings_href = EXCLUDED.settings_href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- Backfill: every existing tenant "hires" Bilbo by default (idempotent).
INSERT INTO tenant_ai_employees (tenant_id, employee_id, hired, active)
SELECT t.id, e.id, TRUE, TRUE
FROM tenants t
CROSS JOIN ai_employees e
WHERE e.key = 'bilbo'
ON CONFLICT (tenant_id, employee_id) DO NOTHING;
