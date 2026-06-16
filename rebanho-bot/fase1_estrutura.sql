-- ============================================================
-- FASE 1 — Parte 1: Criar tabelas + seed básico
-- ============================================================

-- 1. FAZENDAS
CREATE TABLE IF NOT EXISTS fazendas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              TEXT NOT NULL,
  nome_normalizado  TEXT NOT NULL,
  municipio         TEXT,
  estado            TEXT DEFAULT 'RJ',
  area_total_ha     NUMERIC(10,2),
  ativo             BOOLEAN DEFAULT TRUE,
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (nome_normalizado)
);

-- 2. PASTOS
CREATE TABLE IF NOT EXISTS pastos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id    UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  area_ha       NUMERIC(8,2),
  forrageira    TEXT,
  ativo         BOOLEAN DEFAULT TRUE,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome)
);

-- 3. LOTES
CREATE TABLE IF NOT EXISTS lotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fazenda_id    UUID NOT NULL REFERENCES fazendas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  finalidade    TEXT CHECK (finalidade IN (
                  'cria', 'recria', 'engorda',
                  'reproducao', 'descarte', 'geral'
                )),
  ativo         BOOLEAN DEFAULT TRUE,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fazenda_id, nome)
);

-- 4. HISTÓRICO LOTE x PASTO
CREATE TABLE IF NOT EXISTS lote_pasto_historico (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id     UUID NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  pasto_id    UUID NOT NULL REFERENCES pastos(id) ON DELETE CASCADE,
  entrada     DATE NOT NULL,
  saida       DATE,
  observacao  TEXT,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CATEGORIAS
CREATE TABLE IF NOT EXISTS categorias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       TEXT NOT NULL UNIQUE,
  nome         TEXT NOT NULL,
  sexo         TEXT CHECK (sexo IN ('M', 'F')),
  faixa_etaria TEXT,
  ordem        INTEGER,
  ativo        BOOLEAN DEFAULT TRUE
);

-- 6. TIPOS DE ANIMAL
CREATE TABLE IF NOT EXISTS tipos_animal (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome  TEXT NOT NULL UNIQUE,
  ativo BOOLEAN DEFAULT TRUE
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_pastos_fazenda ON pastos (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lotes_fazenda ON lotes (fazenda_id) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_lote_pasto_lote ON lote_pasto_historico (lote_id);
CREATE INDEX IF NOT EXISTS idx_lote_pasto_ativo ON lote_pasto_historico (lote_id) WHERE saida IS NULL;

-- RLS
ALTER TABLE fazendas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pastos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_pasto_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_animal         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON fazendas;
DROP POLICY IF EXISTS "service_role_all" ON pastos;
DROP POLICY IF EXISTS "service_role_all" ON lotes;
DROP POLICY IF EXISTS "service_role_all" ON lote_pasto_historico;
DROP POLICY IF EXISTS "service_role_all" ON categorias;
DROP POLICY IF EXISTS "service_role_all" ON tipos_animal;

CREATE POLICY "service_role_all" ON fazendas             FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON pastos               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lotes                FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON lote_pasto_historico FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON categorias           FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON tipos_animal         FOR ALL USING (auth.role() = 'service_role');

-- SEED: Fazendas
INSERT INTO fazendas (nome, nome_normalizado, estado) VALUES
  ('Grupo Ricci', 'grupo ricci', 'RJ'),
  ('Fazenda A',   'fazenda a',   'RJ'),
  ('Fazenda B',   'fazenda b',   'RJ'),
  ('Fazenda C',   'fazenda c',   'RJ')
ON CONFLICT (nome_normalizado) DO NOTHING;

-- SEED: Categorias
INSERT INTO categorias (codigo, nome, sexo, faixa_etaria, ordem) VALUES
  ('1.1', 'Bezerros 0-8m',    'M', '0-8 meses',   1),
  ('1.2', 'Bezerros 8-12m',   'M', '8-12 meses',  2),
  ('1.3', 'Garrotes 13-24m',  'M', '13-24 meses', 3),
  ('1.4', 'Garrotes 25-36m',  'M', '25-36 meses', 4),
  ('1.5', 'Bois 25-36m',      'M', '25-36 meses', 5),
  ('1.6', 'Bois acima 36m',   'M', 'acima 36m',   6),
  ('1.7', 'Touros PO',        'M', 'adulto',       7),
  ('2.1', 'Bezerras 0-2m',    'F', '0-2 meses',   8),
  ('2.2', 'Bezerras 3-8m',    'F', '3-8 meses',   9),
  ('2.3', 'Bezerras 9-12m',   'F', '9-12 meses',  10),
  ('2.4', 'Novilhas 13-24m',  'F', '13-24 meses', 11),
  ('2.5', 'Novilhas 25-36m',  'F', '25-36 meses', 12),
  ('2.6', 'Vacas solteiras',  'F', 'adulta',       13),
  ('2.7', 'Vacas paridas',    'F', 'adulta',       14),
  ('2.8', 'Vacas prenhas',    'F', 'adulta',       15)
ON CONFLICT (codigo) DO NOTHING;

-- SEED: Tipos de animal
INSERT INTO tipos_animal (nome) VALUES
  ('Nelore'), ('Angus'), ('Cruzado'), ('Girolando'), ('Outros')
ON CONFLICT (nome) DO NOTHING;

-- SEED: Pastos
INSERT INTO pastos (fazenda_id, nome, area_ha, forrageira)
SELECT id, 'Pasto 01', 50.0, 'Brachiaria brizantha'
FROM fazendas WHERE nome_normalizado = 'fazenda a'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

INSERT INTO pastos (fazenda_id, nome, area_ha, forrageira)
SELECT id, 'Pasto 02', 35.0, 'Panicum maximum'
FROM fazendas WHERE nome_normalizado = 'fazenda a'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

INSERT INTO pastos (fazenda_id, nome, area_ha, forrageira)
SELECT id, 'Retiro 01', 80.0, 'Brachiaria brizantha'
FROM fazendas WHERE nome_normalizado = 'fazenda b'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

-- SEED: Lotes
INSERT INTO lotes (fazenda_id, nome, finalidade)
SELECT id, 'Lote Cria', 'cria' FROM fazendas WHERE nome_normalizado = 'fazenda a'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

INSERT INTO lotes (fazenda_id, nome, finalidade)
SELECT id, 'Lote Recria', 'recria' FROM fazendas WHERE nome_normalizado = 'fazenda a'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

INSERT INTO lotes (fazenda_id, nome, finalidade)
SELECT id, 'Lote Engorda', 'engorda' FROM fazendas WHERE nome_normalizado = 'fazenda a'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

INSERT INTO lotes (fazenda_id, nome, finalidade)
SELECT id, 'Lote Reproducao', 'reproducao' FROM fazendas WHERE nome_normalizado = 'fazenda b'
ON CONFLICT (fazenda_id, nome) DO NOTHING;

-- VIEW: lote atual por pasto
CREATE OR REPLACE VIEW vw_lote_pasto_atual AS
SELECT
  lph.lote_id,
  l.nome       AS lote_nome,
  l.finalidade,
  lph.pasto_id,
  p.nome       AS pasto_nome,
  p.area_ha,
  f.nome       AS fazenda_nome,
  lph.entrada
FROM lote_pasto_historico lph
JOIN lotes   l ON l.id = lph.lote_id
JOIN pastos  p ON p.id = lph.pasto_id
JOIN fazendas f ON f.id = p.fazenda_id
WHERE lph.saida IS NULL;
