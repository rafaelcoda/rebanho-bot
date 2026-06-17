-- ============================================================
-- FASE 3 — Estrutura definitiva Grupo Ricci
-- Hierarquia: Fazenda > Retiro > Subdivisão > Lote
-- ============================================================

-- ── 1. DROPAR TABELAS ANTIGAS (fase1 e fase3 anteriores) ─────
DROP TABLE IF EXISTS lote_pasto_historico CASCADE;
DROP TABLE IF EXISTS lote_subdivisao_historico CASCADE;
DROP TABLE IF EXISTS lotes CASCADE;
DROP TABLE IF EXISTS pastos CASCADE;
DROP TABLE IF EXISTS subdivisoes CASCADE;
DROP TABLE IF EXISTS areas CASCADE;

-- ── 2. REMOVER LINHAS ANTIGAS DE FAZENDAS (dados fictícios) ──
DELETE FROM fazendas WHERE nome_normalizado IN (
  'grupo ricci', 'fazenda a', 'fazenda b', 'fazenda c'
);

-- ── 3. ATUALIZAR TABELA FAZENDAS ─────────────────────────────
ALTER TABLE fazendas
  ADD COLUMN IF NOT EXISTS tipo TEXT CHECK (tipo IN (
    'propria', 'arrendamento', 'parceria'
  )) DEFAULT 'propria',
  ADD COLUMN IF NOT EXISTS fazenda_pai_id UUID REFERENCES fazendas(id);
  -- fazenda_pai_id: preenchido quando este registro é um Retiro

-- ── 4. INSERIR FAZENDAS E RETIROS REAIS ──────────────────────
-- Fazendas principais
INSERT INTO fazendas (nome, nome_normalizado, estado, tipo) VALUES
  ('Iturama',          'iturama',          'MG', 'propria'),
  ('Fazenda Aliança',  'fazenda alianca',  'MG', 'propria'),
  ('Arrendamento FRG', 'arrendamento frg', 'MG', 'arrendamento'),
  ('Arrendamento RIV', 'arrendamento riv', 'MG', 'arrendamento')
ON CONFLICT (nome_normalizado) DO UPDATE SET
  tipo   = EXCLUDED.tipo,
  estado = EXCLUDED.estado;

-- ── 5. NOVA TABELA: SUBDIVISOES ───────────────────────────────
-- Representa: Pasto / Confinamento / Piquete (numerado)
-- É o nível intermediário entre Fazenda/Retiro e Lote
CREATE TABLE IF NOT EXISTS subdivisoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN (
                     'pasto',
                     'confinamento',
                     'piquete',
                     'curral',
                     'outros'
                   )),
  numero           INTEGER,            -- ex: Piquete 3 → numero = 3
  area_ha          NUMERIC(10,2),
  forrageira       TEXT,               -- só para pastos
  capacidade_cab   INTEGER,
  ativo            BOOLEAN DEFAULT TRUE,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome_normalizado)
);

-- ── 6. NOVA TABELA: LOTES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  subdivisao_id    UUID REFERENCES subdivisoes(id),
  nome             TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  numero           INTEGER,            -- ex: Lote 3 → numero = 3
  finalidade       TEXT CHECK (finalidade IN (
                     'cria', 'recria', 'engorda',
                     'reproducao', 'descarte', 'geral'
                   )),
  ativo            BOOLEAN DEFAULT TRUE,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome_normalizado)
);

-- ── 7. HISTÓRICO DE LOCALIZAÇÃO DO LOTE ──────────────────────
CREATE TABLE IF NOT EXISTS lote_historico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  subdivisao_id UUID NOT NULL REFERENCES subdivisoes(id) ON DELETE CASCADE,
  entrada       DATE NOT NULL,
  saida         DATE,       -- NULL = ainda nesta subdivisão
  observacao    TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. ADICIONAR CAMPOS EM MOVIMENTACOES_LOTE ────────────────
ALTER TABLE movimentacoes_lote
  ADD COLUMN IF NOT EXISTS subdivisao_id UUID REFERENCES subdivisoes(id),
  ADD COLUMN IF NOT EXISTS peso_total_kg NUMERIC(10,2),  -- peso total do lote
  ADD COLUMN IF NOT EXISTS peso_medio_kg NUMERIC(10,2);  -- calculado: peso_total / quantidade

-- ── 9. ÍNDICES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sub_fazenda    ON subdivisoes    (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_sub_tipo       ON subdivisoes    (tipo)       WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lotes_fazenda  ON lotes          (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lotes_sub      ON lotes          (subdivisao_id);
CREATE INDEX IF NOT EXISTS idx_hist_lote      ON lote_historico (lote_id);
CREATE INDEX IF NOT EXISTS idx_mov_sub        ON movimentacoes_lote (subdivisao_id);

-- ── 10. RLS ───────────────────────────────────────────────────
ALTER TABLE subdivisoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON subdivisoes;
DROP POLICY IF EXISTS "service_role_all" ON lotes;
DROP POLICY IF EXISTS "service_role_all" ON lote_historico;
DROP POLICY IF EXISTS "anon_read"        ON subdivisoes;
DROP POLICY IF EXISTS "anon_read"        ON lotes;

CREATE POLICY "service_role_all" ON subdivisoes    FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lotes          FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lote_historico FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "anon_read"        ON subdivisoes    FOR SELECT USING (true);
CREATE POLICY "anon_read"        ON lotes          FOR SELECT USING (true);

-- ── 11. SEED: SUBDIVISÕES DA ITURAMA (exemplo) ───────────────
INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo, numero)
SELECT id, 'Pasto 01', 'pasto 01', 'pasto', 1
FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo, numero)
SELECT id, 'Pasto 02', 'pasto 02', 'pasto', 2
FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Confinamento', 'confinamento', 'confinamento'
FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo, numero)
SELECT id, 'Piquete 1', 'piquete 1', 'piquete', 1
FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo, numero)
SELECT id, 'Piquete 2', 'piquete 2', 'piquete', 2
FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

-- ── 12. VIEW: estado atual dos lotes ─────────────────────────
CREATE OR REPLACE VIEW vw_lotes_atual AS
SELECT
  l.id            AS lote_id,
  l.nome          AS lote_nome,
  l.numero        AS lote_numero,
  l.finalidade,
  s.id            AS subdivisao_id,
  s.nome          AS subdivisao_nome,
  s.tipo          AS subdivisao_tipo,
  s.area_ha,
  f.id            AS fazenda_id,
  f.nome          AS fazenda_nome,
  f.tipo          AS fazenda_tipo,
  lh.entrada
FROM lotes l
JOIN fazendas    f  ON f.id = l.fazenda_id
LEFT JOIN subdivisoes s  ON s.id = l.subdivisao_id
LEFT JOIN lote_historico lh ON lh.lote_id = l.id AND lh.saida IS NULL
WHERE l.ativo = TRUE;

-- ── 13. TRIGGER: calcular peso médio automaticamente ─────────
CREATE OR REPLACE FUNCTION calc_peso_medio()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.peso_total_kg IS NOT NULL AND NEW.quantidade > 0 THEN
    NEW.peso_medio_kg := ROUND(NEW.peso_total_kg / NEW.quantidade, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_peso_medio ON movimentacoes_lote;
CREATE TRIGGER trg_peso_medio
  BEFORE INSERT OR UPDATE ON movimentacoes_lote
  FOR EACH ROW EXECUTE FUNCTION calc_peso_medio();

