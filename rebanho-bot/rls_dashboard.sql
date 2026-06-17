-- Permitir leitura anônima para o dashboard
DROP POLICY IF EXISTS "anon_read" ON movimentacoes_lote;
DROP POLICY IF EXISTS "anon_read" ON lotes;
DROP POLICY IF EXISTS "anon_read" ON fazendas;
DROP POLICY IF EXISTS "anon_read" ON bot_anomalias;

CREATE POLICY "anon_read" ON movimentacoes_lote FOR SELECT USING (true);
CREATE POLICY "anon_read" ON lotes FOR SELECT USING (true);
CREATE POLICY "anon_read" ON fazendas FOR SELECT USING (true);
CREATE POLICY "anon_read" ON bot_anomalias FOR SELECT USING (true);
