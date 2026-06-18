-- ============================================================
-- Atualizar categorias com dados corretos do Grupo Ricci
-- ============================================================

-- Limpar categorias antigas
DELETE FROM categorias;

-- Inserir categorias corretas
INSERT INTO categorias (id, codigo, nome, sexo, faixa_etaria, ordem, ativo) VALUES
('999f19d3-7792-41e8-b1fa-14038e37d1fb', '1.1', 'Bezerros 0-2m',    'M', '0-2meses',    1,  true),
('05e82f7d-3b4c-4ea5-86e3-4134b384cf75', '1.2', 'Bezerros 3-8m',    'M', '3-8 meses',   2,  true),
('86bc866b-ea33-480f-84a8-826f54249092', '1.3', 'Garrotes 9-12m',   'M', '9-12 meses',  3,  true),
('36e02678-09f0-4fbb-a07d-d43d85aa7130', '1.4', 'Garrotes 13-24m',  'M', '13-24 meses', 4,  true),
('fb148286-114b-4fa0-bb29-94515e836e85', '1.5', 'Bois 25-36m',      'M', '25-36 meses', 5,  true),
('a163b0cb-f92f-4241-ba99-90bda1ae7a25', '1.6', 'Bois acima 36m',   'M', 'acima 36m',   6,  true),
('1aff1554-bb28-460d-b339-cc67bec60137', '1.7', 'Touros PO',        'M', 'adulto',       7,  true),
('3b8fe918-0148-4b05-81cc-daf370126bf9', '2.1', 'Bezerras 0-2m',   'F', '0-2 meses',   8,  true),
('3ab81f4a-7b51-4b49-9885-59fcca92a847', '2.2', 'Bezerras 3-8m',   'F', '3-8 meses',   9,  true),
('2541e49a-826c-4769-99bb-d29310e4e3f8', '2.3', 'Bezerras 9-12m',  'F', '9-12 meses',  10, true),
('d94296a9-4487-4522-b740-ec46c70c918b', '2.4', 'Novilhas 13-24m', 'F', '13-24 meses', 11, true),
('d5d93c0f-dab1-4136-9c05-163384784552', '2.5', 'Novilhas 25-36m', 'F', '25-36 meses', 12, true),
('66b0db12-ab24-4ca8-a0d8-98690a3926bd', '2.6', 'Vacas solteiras',  'F', 'adulta',      13, true),
('58af207b-4113-440a-8177-546e4bbedbd5', '2.7', 'Vacas paridas',    'F', 'adulta',      14, true),
('fc9bb98a-58a5-4259-be24-45ddda65d38f', '2.8', 'Vacas prenhas',    'F', 'adulta',      15, true);

-- Verificar resultado
SELECT codigo, nome, sexo, faixa_etaria FROM categorias ORDER BY ordem;
