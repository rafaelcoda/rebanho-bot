CREATE OR REPLACE VIEW vw_resumo_mensal AS
SELECT
  COALESCE(m.fazenda, 'Grupo Ricci') AS fazenda,
  EXTRACT(MONTH FROM m.data_mov::date)::int AS mes,
  EXTRACT(YEAR FROM m.data_mov::date)::int AS ano,
  SUM(m.quantidade) FILTER (WHERE m.tipo = 'nascimento')          AS nascimentos,
  SUM(m.quantidade) FILTER (WHERE m.tipo IN ('morte','abate'))    AS mortes,
  SUM(m.quantidade) FILTER (WHERE m.tipo = 'compra')              AS compras,
  SUM(m.quantidade) FILTER (WHERE m.tipo = 'venda')               AS vendas,
  SUM(m.quantidade) FILTER (WHERE m.tipo = 'abate')               AS abates,
  SUM(m.quantidade) FILTER (WHERE m.tipo = 'desmama')             AS desmamas,
  SUM(m.quantidade) FILTER (WHERE m.tipo IN ('nascimento','compra','desmama','mudanca_categoria')) AS total_entradas,
  SUM(m.quantidade) FILTER (WHERE m.tipo IN ('morte','abate','venda')) AS total_saidas,
  SUM(CASE
    WHEN m.tipo IN ('nascimento','compra','mudanca_categoria') THEN m.quantidade
    WHEN m.tipo IN ('morte','abate','venda') THEN -m.quantidade
    ELSE 0
  END) AS saldo_periodo,
  SUM(m.quantidade) AS total_rebanho,
  COALESCE(SUM(m.quantidade) FILTER (WHERE m.categoria LIKE '1.%'), 0) AS total_machos,
  COALESCE(SUM(m.quantidade) FILTER (WHERE m.categoria LIKE '2.%'), 0) AS total_femeas,
  CASE
    WHEN SUM(m.quantidade) FILTER (WHERE m.tipo IN ('nascimento','compra')) > 0
    THEN ROUND((
      SUM(m.quantidade) FILTER (WHERE m.tipo IN ('morte','abate'))::numeric /
      NULLIF(SUM(m.quantidade) FILTER (WHERE m.tipo IN ('nascimento','compra')), 0)
    ) * 100, 2)
    ELSE 0
  END AS mortalidade_pct,
  MAX(m.data_mov::date) AS ultima_movimentacao
FROM movimentacoes_lote m
WHERE m.data_mov IS NOT NULL
GROUP BY
  COALESCE(m.fazenda, 'Grupo Ricci'),
  EXTRACT(MONTH FROM m.data_mov::date),
  EXTRACT(YEAR FROM m.data_mov::date);
