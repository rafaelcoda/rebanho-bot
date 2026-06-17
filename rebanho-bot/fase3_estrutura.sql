-- ============================================================
-- FASE 3 — Estrutura completa Grupo Ricci
-- Hierarquia: Fazenda/Retiro > Pasto/Confinamento/Piquete > Lote
-- ============================================================

-- ── 1. DROPAR TABELAS ANTIGAS (criadas na Fase 1, estrutura errada) ──
DROP TABLE IF EXISTS lote_pasto_historico CASCADE;
DROP TABLE IF EXISTS lotes CASCADE;
DROP TABLE IF EXISTS pastos CASCADE;
DROP TABLE IF EXISTS areas CASCADE;

-- ── 2. ADICIONAR COLUNAS EM FAZENDAS ─────────────────────────
ALTER TABLE fazendas
  ADD COLUMN IF NOT EXISTS tipo TEXT CHECK (tipo IN (
    'propria', 'arrendamento', 'parceria'
  )) DEFAULT 'propria',
  ADD COLUMN IF NOT EXISTS retiro_de UUID REFERENCES fazendas(id);
  -- retiro_de: se preenchido, este registro é um retiro de outra fazenda

-- ── 3. INSERIR FAZENDAS REAIS ────────────────────────────────
INSERT INTO fazendas (nome, nome_normalizado, estado, tipo) VALUES
  ('Iturama',          'iturama',          'MG', 'propria'),
  ('Fazenda Aliança',  'fazenda alianca',  'MG', 'propria'),
  ('Arrendamento FRG', 'arrendamento frg', 'MG', 'arrendamento'),
  ('Arrendamento RIV', 'arrendamento riv', 'MG', 'arrendamento')
ON CONFLICT (nome_normalizado) DO UPDATE SET
  tipo = EXCLUDED.tipo,
  estado = EXCLUDED.estado;

-- ── 4. NOVA TABELA: SUBDIVISOES ───────────────────────────────
-- Representa: Pasto / Confinamento / Piquete (nível intermediário)
CREATE TABLE IF NOT EXISTS subdivisoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,          -- ex: "Pasto 01", "Confinamento", "Piquete 3"
  nome_normalizado TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN (
                     'pasto',
                     'confinamento',
                     'piquete',
                     'curral',
                     'outros'
                   )),
  area_ha          NUMERIC(10,2),
  forrageira       TEXT,                   -- ex: "Brachiaria brizantha" (só para pastos)
  capacidade_cab   INTEGER,                -- capacidade máxima em cabeças
  ativo            BOOLEAN DEFAULT TRUE,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome_normalizado)
);

-- ── 5. NOVA TABELA: LOTES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id       UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  subdivisao_id    UUID REFERENCES subdivisoes(id),  -- pasto/confinamento onde está
  nome             TEXT NOT NULL,          -- ex: "Lote 1", "Lote Engorda"
  nome_normalizado TEXT NOT NULL,
  finalidade       TEXT CHECK (finalidade IN (
                     'cria', 'recria', 'engorda',
                     'reproducao', 'descarte', 'geral'
                   )),
  ativo            BOOLEAN DEFAULT TRUE,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome_normalizado)
);

-- ── 6. HISTÓRICO DE LOTE x SUBDIVISÃO (rotação de pasto) ─────
CREATE TABLE IF NOT EXISTS lote_subdivisao_historico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  subdivisao_id UUID NOT NULL REFERENCES subdivisoes(id) ON DELETE CASCADE,
  entrada       DATE NOT NULL,
  saida         DATE,             -- NULL = ainda nesta subdivisão
  observacao    TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. ADICIONAR COLUNAS FK EM MOVIMENTACOES_LOTE ────────────
ALTER TABLE movimentacoes_lote
  ADD COLUMN IF NOT EXISTS subdivisao_id UUID REFERENCES subdivisoes(id);

-- ── 8. ÍNDICES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subdivisoes_fazenda ON subdivisoes (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lotes_fazenda       ON lotes       (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lotes_subdivisao    ON lotes       (subdivisao_id);
CREATE INDEX IF NOT EXISTS idx_hist_lote           ON lote_subdivisao_historico (lote_id);
CREATE INDEX IF NOT EXISTS idx_hist_subdivisao     ON lote_subdivisao_historico (subdivisao_id);
CREATE INDEX IF NOT EXISTS idx_mov_subdivisao      ON movimentacoes_lote (subdivisao_id);

-- ── 9. RLS ────────────────────────────────────────────────────
ALTER TABLE subdivisoes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_subdivisao_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON subdivisoes;
DROP POLICY IF EXISTS "service_role_all" ON lotes;
DROP POLICY IF EXISTS "service_role_all" ON lote_subdivisao_historico;
DROP POLICY IF EXISTS "anon_read"        ON subdivisoes;
DROP POLICY IF EXISTS "anon_read"        ON lotes;

CREATE POLICY "service_role_all" ON subdivisoes               FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lotes                     FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lote_subdivisao_historico FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "anon_read"        ON subdivisoes               FOR SELECT USING (true);
CREATE POLICY "anon_read"        ON lotes                     FOR SELECT USING (true);

-- ── 10. SEED: SUBDIVISÕES E LOTES DA ITURAMA ─────────────────
-- Pastos
INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Pasto 01', 'pasto 01', 'pasto' FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Pasto 02', 'pasto 02', 'pasto' FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

-- Confinamento
INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Confinamento', 'confinamento', 'confinamento' FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

-- Piquetes
INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Piquete 1', 'piquete 1', 'piquete' FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

INSERT INTO subdivisoes (fazenda_id, nome, nome_normalizado, tipo)
SELECT id, 'Piquete 2', 'piquete 2', 'piquete' FROM fazendas WHERE nome_normalizado = 'iturama'
ON CONFLICT (fazenda_id, nome_normalizado) DO NOTHING;

-- ── 11. VIEW ATUALIZADA ───────────────────────────────────────
CREATE OR REPLACE VIEW vw_lote_subdivisao_atual AS
SELECT
  lsh.lote_id,
  l.nome        AS lote_nome,
  l.finalidade,
  lsh.subdivisao_id,
  s.nome        AS subdivisao_nome,
  s.tipo        AS subdivisao_tipo,
  s.area_ha,
  f.nome        AS fazenda_nome,
  lsh.entrada
FROM lote_subdivisao_historico lsh
JOIN lotes      l ON l.id = lsh.lote_id
JOIN subdivisoes s ON s.id = lsh.subdivisao_id
JOIN fazendas   f ON f.id = s.fazenda_id
WHERE lsh.saida IS NULL;

