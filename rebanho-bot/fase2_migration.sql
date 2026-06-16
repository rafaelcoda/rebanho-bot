-- Fase 2: adicionar colunas FK em movimentacoes_lote
ALTER TABLE movimentacoes_lote
  ADD COLUMN IF NOT EXISTS fazenda_id     UUID REFERENCES fazendas(id),
  ADD COLUMN IF NOT EXISTS lote_id        UUID REFERENCES lotes(id),
  ADD COLUMN IF NOT EXISTS tipo_animal_id UUID REFERENCES tipos_animal(id);

-- Indices
CREATE INDEX IF NOT EXISTS idx_mov_fazenda_id ON movimentacoes_lote (fazenda_id);
CREATE INDEX IF NOT EXISTS idx_mov_lote_id    ON movimentacoes_lote (lote_id);

-- Migrar dados existentes
UPDATE movimentacoes_lote m
SET fazenda_id = f.id
FROM fazendas f
WHERE LOWER(m.fazenda) = f.nome_normalizado
  AND m.fazenda_id IS NULL;
