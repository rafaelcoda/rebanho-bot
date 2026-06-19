-- Limpar subdivisoes duplicadas (sem codigo = seeds antigos)
DELETE FROM subdivisoes WHERE codigo IS NULL;

-- Verificar resultado
SELECT f.nome as fazenda, COUNT(*) as total
FROM subdivisoes s
JOIN fazendas f ON f.id = s.fazenda_id
WHERE s.ativo = true
GROUP BY f.nome ORDER BY f.nome;
