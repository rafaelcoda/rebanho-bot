-- ============================================================
-- FASE 3 — Tabela de áreas + fazendas reais do Grupo Ricci
-- ============================================================

-- ── 1. ADICIONAR COLUNA estado_uf EM FAZENDAS ────────────────
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS estado_uf TEXT;
ALTER TABLE fazendas ADD COLUMN IF NOT EXISTS tipo TEXT CHECK (tipo IN (
  'propria', 'arrendamento', 'parceria'
)) DEFAULT 'propria';

-- ── 2. ATUALIZAR/INSERIR FAZENDAS REAIS ──────────────────────
INSERT INTO fazendas (nome, nome_normalizado, tipo) VALUES
  ('Iturama',           'iturama',           'propria'),
  ('Fazenda Aliança',   'fazenda alianca',   'propria'),
  ('Arrendamento FRG',  'arrendamento frg',  'arrendamento'),
  ('Arrendamento RIV',  'arrendamento riv',  'arrendamento')
ON CONFLICT (nome_normalizado) DO UPDATE SET
  tipo = EXCLUDED.tipo;

-- ── 3. TABELA DE ÁREAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS areas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN (
                     'pastagem',
                     'confinamento',
                     'agricultura',
                     'benfeitoria',
                     'reserva',
                     'outros'
                   )),
  tem_animais      BOOLEAN DEFAULT TRUE,
  area_ha          NUMERIC(10,2),
  ativo            BOOLEAN DEFAULT TRUE,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_areas_fazenda ON areas (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_areas_tipo ON areas (tipo) WHERE ativo = TRUE;

-- ── 4. ADICIONAR area_id EM LOTES ────────────────────────────
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id);

-- ── 5. RLS ───────────────────────────────────────────────────
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON areas;
DROP POLICY IF EXISTS "anon_read"        ON areas;

CREATE POLICY "service_role_all" ON areas FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "anon_read"        ON areas FOR SELECT USING (true);

-- ── 6. SEED: ÁREAS PADRÃO PARA CADA FAZENDA ──────────────────
-- Iturama
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Pastagem',     'pastagem',     'pastagem',     true  FROM fazendas WHERE nome_normalizado = 'iturama' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Confinamento', 'confinamento', 'confinamento', true  FROM fazendas WHERE nome_normalizado = 'iturama' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Agricultura',  'agricultura',  'agricultura',  false FROM fazendas WHERE nome_normalizado = 'iturama' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Benfeitorias', 'benfeitorias', 'benfeitoria',  false FROM fazendas WHERE nome_normalizado = 'iturama' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Reserva',      'reserva',      'reserva',      false FROM fazendas WHERE nome_normalizado = 'iturama' ON CONFLICT DO NOTHING;

-- Fazenda Aliança
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Pastagem',     'pastagem',     'pastagem',     true  FROM fazendas WHERE nome_normalizado = 'fazenda alianca' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Confinamento', 'confinamento', 'confinamento', true  FROM fazendas WHERE nome_normalizado = 'fazenda alianca' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Agricultura',  'agricultura',  'agricultura',  false FROM fazendas WHERE nome_normalizado = 'fazenda alianca' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Benfeitorias', 'benfeitorias', 'benfeitoria',  false FROM fazendas WHERE nome_normalizado = 'fazenda alianca' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Reserva',      'reserva',      'reserva',      false FROM fazendas WHERE nome_normalizado = 'fazenda alianca' ON CONFLICT DO NOTHING;

-- Arrendamento FRG
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Pastagem',     'pastagem',     'pastagem',     true  FROM fazendas WHERE nome_normalizado = 'arrendamento frg' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Confinamento', 'confinamento', 'confinamento', true  FROM fazendas WHERE nome_normalizado = 'arrendamento frg' ON CONFLICT DO NOTHING;

-- Arrendamento RIV
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Pastagem',     'pastagem',     'pastagem',     true  FROM fazendas WHERE nome_normalizado = 'arrendamento riv' ON CONFLICT DO NOTHING;
INSERT INTO areas (fazenda_id, nome, nome_normalizado, tipo, tem_animais)
SELECT id, 'Confinamento', 'confinamento', 'confinamento', true  FROM fazendas WHERE nome_normalizado = 'arrendamento riv' ON CONFLICT DO NOTHING;

