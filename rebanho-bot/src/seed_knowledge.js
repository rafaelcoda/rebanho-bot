// seed_knowledge.js — Popular knowledge_base com documentos técnicos de pecuária
// Executar: node seed_knowledge.js

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const axios = require('axios')
const ws = require('ws')

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { global: { WebSocket: ws } }
)

async function embedding(texto) {
  const r = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: 'text-embedding-3-small', input: texto },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  )
  return r.data.data[0].embedding
}

const documentos = [

  // ── ÍNDICES ZOOTÉCNICOS ──────────────────────────────────────
  {
    titulo: 'Índices zootécnicos de referência — rebanho bovino de corte',
    categoria: 'indice_zootecnico',
    fonte: 'Embrapa Gado de Corte',
    tags: ['índices', 'referência', 'mortalidade', 'natalidade', 'produtividade'],
    conteudo: `Índices zootécnicos de referência para bovinos de corte no Brasil Central (Cerrado):

MORTALIDADE:
- Bezerros até 1 ano: até 5% considerado normal. Acima de 8%: alerta. Acima de 12%: crítico.
- Adultos: até 2% ao ano é normal. Acima de 3%: investigar causas.
- Causas mais comuns de mortalidade em bezerros: diarreia neonatal (primeiros 30 dias), carência mineral (cobre, selênio), pneumonia, tristeza parasitária (após desmama).

NATALIDADE:
- Taxa de natalidade ideal: acima de 80% para sistemas de ciclo completo.
- Abaixo de 65%: problema de manejo reprodutivo ou nutricional.
- Intervalo entre partos ideal: 12 meses. Acima de 14 meses: indicador de problema.

GANHO DE PESO:
- Bezerros a pasto: 0,5 a 0,7 kg/dia considerado bom.
- Garrotes em recria intensiva: 0,8 a 1,2 kg/dia.
- Touros em serviço: perda de até 10% do peso é normal na monta.

RELAÇÃO TOURO:VACA:
- Monta natural: 1 touro para 25-30 vacas em piquete rotativo.
- Monta controlada: 1 touro para até 40 vacas.
- Touros jovens (2 anos): não ultrapasse 15 vacas.

DESFRUTE:
- Taxa de desfrute ideal para corte: 18 a 22% ao ano.
- Calculado como: (abates + vendas) / total do rebanho × 100.`
  },

  {
    titulo: 'Mortalidade de bezerros — causas, diagnóstico e prevenção',
    categoria: 'protocolo_sanitario',
    fonte: 'Embrapa / MAPA',
    tags: ['bezerro', 'mortalidade', 'diarreia', 'neonatal', 'prevenção'],
    conteudo: `Mortalidade de bezerros: principais causas e como agir.

DIARREIA NEONATAL (0 a 30 dias de vida):
Principal causa de morte em bezerros jovens. Causas: Escherichia coli, Rotavírus, Coronavírus, Salmonella.
Sinais: fezes líquidas amareladas ou esbranquiçadas, desidratação, fraqueza.
Ação imediata: reidratação oral com eletrólitos (2 a 4 litros por dia), isolamento do animal.
Prevenção: vacinação da vaca gestante (2 meses antes do parto), colostro nas primeiras 6 horas de vida (mínimo 2 litros), limpeza da área de parição.

TRISTEZA PARASITÁRIA BOVINA (Babesiose e Anaplasmose):
Mais comum em bezerros de 6 a 12 meses, especialmente ao sair de área de alta infestação de carrapatos.
Sinais: febre acima de 40°C, anemia, urina vermelha (babesiose), animal parado e triste.
Ação: tratamento imediato com dipropionato de imidocarb (babesiose) ou oxitetraciclina (anaplasmose).
Prevenção: não mover animais jovens abruptamente para áreas novas; controle de carrapatos.

CARÊNCIA MINERAL:
Cobre e selênio são os mais comuns no Cerrado.
Sinais de carência de cobre: pelagem opaca, baixo desenvolvimento, diarreia crônica.
Sinais de carência de selênio: fraqueza muscular em bezerros recém-nascidos (doença do músculo branco).
Prevenção: suplementação mineral correta conforme análise de solo e forrageira da região.

PNEUMONIA:
Mais comum em épocas de variação climática (transição seca-chuva).
Sinais: corrimento nasal, tosse, respiração acelerada, febre.
Prevenção: evitar estresse dos animais, não misturar bezerros de idades muito diferentes.`
  },

  // ── MANEJO ────────────────────────────────────────────────────
  {
    titulo: 'Manejo de pastagens — taxa de lotação e rotação de pasto',
    categoria: 'manejo',
    fonte: 'Embrapa Gado de Corte',
    tags: ['pastagem', 'lotação', 'rotação', 'pasto', 'capim', 'UA'],
    conteudo: `Manejo de pastagens para bovinos de corte.

TAXA DE LOTAÇÃO:
- Expressa em UA/hectare (1 UA = animal de 450 kg).
- Brachiaria brizantha (Marandu): 1 a 2 UA/ha em sistema extensivo, 3 a 5 UA/ha em sistema intensivo com adubação.
- Panicum maximum (Mombaça, Tanzânia): 2 a 4 UA/ha com manejo adequado.
- Taxa de lotação acima da capacidade suporte: degradação acelerada do pasto.

PERÍODO DE DESCANSO:
- Brachiaria: 30 a 35 dias no verão, 60 a 90 dias no inverno/seca.
- Panicum (folhas): 30 folhas por perfilho = momento de entrada dos animais.
- Saída dos animais: quando pasto atingir 25 a 30 cm de altura residual.

SINAIS DE SUPERLOTAÇÃO:
- Pastagem com altura abaixo de 15 cm por período prolongado.
- Solo descoberto em mais de 30% da área.
- Aumento de invasoras (capim navalha, sapé, carqueja).
- Perda de peso dos animais sem causa sanitária aparente.

LOTES POR CATEGORIA:
- Bezerros em recria: 1,5 UA/ha (mais sensíveis, precisam de melhor pasto).
- Vacas gestantes: 1 a 1,5 UA/ha (demanda nutricional maior).
- Bois em engorda: adaptar conforme ganho de peso desejado.

MINERALIZAÇÃO NO PASTO:
- Sal mineral à vontade em cochos cobertos.
- Consumo médio esperado: 60 a 100 g/animal/dia de mineral completo.
- Consumo muito abaixo: investigar palatabilidade ou excesso de sal branco.`
  },

  {
    titulo: 'Desmama de bezerros — idade, técnicas e manejo',
    categoria: 'manejo',
    fonte: 'Embrapa Gado de Corte',
    tags: ['desmama', 'bezerro', 'bezerros', 'bezerra', 'recria', 'estresse'],
    conteudo: `Desmama de bezerros: quando e como fazer corretamente.

IDADE IDEAL:
- Desmama convencional: 7 a 8 meses de idade.
- Desmama precoce: 60 a 90 dias, indicada para melhorar condição corporal da vaca e reduzir intervalo entre partos.
- Desmama temporária (5 dias): técnica para estimular estro em vacas com baixa condição corporal.

CRITÉRIOS PARA DESMAMA:
- Peso mínimo ideal: 160 a 180 kg para raças zebuínas.
- Condição corporal da vaca abaixo de 2,5 (escala 1-5): considerar desmama mais cedo.
- Estação de monta se aproximando: desmamar para melhorar taxa de prenhez.

TÉCNICAS:
- Separação total e imediata: mais estressante mas mais prática.
- Desmama em cerca: bezerro e vaca ficam separados por cerca, contato visual por 7 dias, depois separação total. Reduz estresse.
- Anteparo nasal (nose flap): permite convívio mas impede amamentação. Menos estressante, mais trabalhoso.

MANEJO PÓS-DESMAMA (primeiros 30 dias são críticos):
- Manter bezerros em pasto de qualidade ou suplementação.
- Não misturar bezerros recém-desmamados com animais muito mais velhos.
- Vacinação contra clostridioses e FMD deve estar em dia.
- Monitorar peso: perda de até 5 kg no primeiro mês é normal.
- Perda acima de 10 kg: avaliar nutrição e sanidade.

CUIDADOS SANITÁRIOS NO PERÍODO:
- Vermifugação estratégica: 30 dias antes ou no momento da desmama.
- Observar sinais de tristeza parasitária (risco aumentado pós-desmama).
- Fornecimento de sal mineral e água limpa à vontade.`
  },

  // ── REPRODUÇÃO ────────────────────────────────────────────────
  {
    titulo: 'Estação de monta — planejamento e manejo reprodutivo',
    categoria: 'reproducao',
    fonte: 'Embrapa Gado de Corte',
    tags: ['reprodução', 'monta', 'touro', 'prenhez', 'iatf', 'estação'],
    conteudo: `Estação de monta: como planejar e executar para maximizar natalidade.

DURAÇÃO DA ESTAÇÃO DE MONTA:
- Estação de 60 a 90 dias: permite concentrar partos numa época, facilita manejo.
- Estações mais curtas aumentam uniformidade do lote mas exigem mais atenção à condição corporal das vacas.
- Melhor época no Cerrado: outubro a dezembro (início das chuvas), partos entre julho e setembro.

CONDIÇÃO CORPORAL DAS VACAS:
- Escore mínimo para entrar na estação de monta: 3,0 (escala 1-5).
- Abaixo de 2,5: vaca dificilmente ciclará.
- Protocolo: avaliar condição corporal 60 dias antes da monta e suplementar as que estiverem abaixo.

SELEÇÃO E PREPARO DOS TOUROS:
- Exame andrológico obrigatório 60 dias antes da monta.
- Circunferência escrotal mínima: 34 cm para touros Nelore de 2 anos.
- Touro reprovado no exame: não usar. Substituir.
- Descanso de 60 dias antes da estação: touro sem trabalho reprodutivo.
- Proporção: 1 touro para 25 vacas (touros de 3+ anos), 1 para 15 (touros jovens, 2 anos).

IATF (INSEMINAÇÃO ARTIFICIAL EM TEMPO FIXO):
- Permite atingir taxa de prenhez de 50 a 65% em 10 dias.
- Protocolo mais comum: D0-D8-D9-D10 com GnRH, progesterona e benzoato de estradiol.
- Vantagem: uniformiza lote de bezerros, permite usar touros superiores geneticamente.
- Exige vacas em boa condição corporal e manejo adequado do estresse.

DIAGNÓSTICO DE PRENHEZ:
- Palpação retal: a partir de 60 dias de gestação.
- Ultrassonografia: a partir de 25 dias. Permite diagnóstico mais preciso.
- Fêmeas vazias ao diagnóstico: reclassificar para descarte ou nova oportunidade.`
  },

  // ── NUTRIÇÃO ─────────────────────────────────────────────────
  {
    titulo: 'Suplementação mineral para bovinos de corte — Cerrado',
    categoria: 'nutricao',
    fonte: 'Embrapa Cerrados / Embrapa Gado de Corte',
    tags: ['mineral', 'suplementação', 'sal', 'cobre', 'fósforo', 'Cerrado'],
    conteudo: `Suplementação mineral para bovinos no Cerrado brasileiro.

DEFICIÊNCIAS MAIS COMUNS NO CERRADO:
- Fósforo: deficiência generalizada. Sintomas: apetite depravado (comer ossos, madeira), baixo desenvolvimento.
- Cobre: deficiência frequente, especialmente em solos argilosos. Pelagem opaca, despigmentada.
- Selênio: deficiência em solos arenosos. Músculo branco em bezerros.
- Zinco: importante para imunidade e reprodução.
- Cobalto: deficiência em solos de Cerrado típico.

COMPOSIÇÃO BÁSICA DO SAL MINERAL PARA CRIA-RECRIA:
- Sal comum (NaCl): 40 a 50%
- Fosfato bicálcico: 30 a 35%
- Sulfato de cobre: 0,3%
- Sulfato de zinco: 0,4%
- Selenito de sódio: 0,008%
- Cloreto de cobalto: 0,01%
- Iodato de potássio: 0,01%

CONSUMO ESPERADO E CONTROLE:
- Consumo ideal: 60 a 100 g/animal/dia para mineral completo.
- Abaixo de 30 g: analisar palatabilidade, adicionar mais sal comum.
- Acima de 150 g: reduzir sal comum na formulação.
- Registrar consumo mensalmente por lote: alterações indicam problema de saúde ou de qualidade do produto.

SUPLEMENTAÇÃO PROTÉICA-ENERGÉTICA NA SECA:
- Novilhos em recria: 300 a 500 g/animal/dia de suplemento com 30 a 40% de proteína bruta.
- Vacas gestantes na seca: 500 g a 1 kg/animal/dia.
- Ureia: não exceder 1% da matéria seca total da dieta. Risco de intoxicação.
- Protocolo de adaptação à ureia: começar com 50% da dose e aumentar gradualmente em 2 semanas.

ÁGUA:
- Consumo médio: 30 a 50 litros/animal/dia.
- Em dias quentes (acima de 35°C): pode chegar a 80 litros.
- Bebedouros: mínimo 10 cm de borda por animal. Limpeza semanal.`
  },

  // ── BOAS PRÁTICAS ─────────────────────────────────────────────
  {
    titulo: 'Registros de rebanho — como e por que registrar corretamente',
    categoria: 'boas_praticas',
    fonte: 'ABIEC / Embrapa',
    tags: ['registro', 'controle', 'gestão', 'mapa', 'rebanho', 'planilha'],
    conteudo: `Por que registrar movimentações do rebanho corretamente.

IMPORTÂNCIA DOS REGISTROS:
- Permite calcular índices zootécnicos reais da fazenda (mortalidade, natalidade, ganho de peso).
- Base para decisões de descarte, compra e venda.
- Rastreabilidade: exigência do mercado exportador (GTA, SISBOV).
- Acesso a crédito rural: bancos exigem comprovação de rebanho.
- Planejamento tributário: movimentações documentadas reduzem riscos fiscais.

O QUE REGISTRAR EM CADA MOVIMENTAÇÃO:
NASCIMENTO: data, categoria (bezerro/bezerra), mãe (se identificada), peso ao nascer se possível.
MORTE: data, categoria, causa provável (doença, acidente, predador), identificação do animal.
COMPRA: data, quantidade, categoria, procedência, preço, GTA número.
VENDA: data, quantidade, categoria, destino, preço, GTA número.
TRANSFERÊNCIA ENTRE LOTES: data, de qual lote, para qual lote, motivo.

FREQUÊNCIA DE CONTAGEM:
- Contagem do rebanho: pelo menos uma vez por mês por categoria.
- Registro de nascimentos: diário ou semanal no período de parição.
- Registro de mortes: imediato ao encontrar o animal.

COMO CALCULAR MORTALIDADE:
Mortalidade (%) = (número de mortes / média do rebanho no período) × 100.
Exemplo: 5 mortes em um rebanho médio de 250 animais = 2% de mortalidade.

SINAL DE ALERTA NO REGISTRO:
- Divergência entre contagem física e registro: investigar furto ou erro de lançamento.
- Aumento súbito de mortes: notificar veterinário imediatamente.
- Queda na taxa de natalidade por dois ciclos seguidos: avaliar touro, pastagem e nutrição.`
  },

  {
    titulo: 'Controle de carrapatos em bovinos — manejo integrado',
    categoria: 'protocolo_sanitario',
    fonte: 'MAPA / Embrapa Gado de Corte',
    tags: ['carrapato', 'tristeza', 'parasita', 'controle', 'banho', 'carrapaticida'],
    conteudo: `Controle estratégico de carrapatos (Rhipicephalus microplus) em bovinos.

POR QUE CONTROLAR:
- Carrapato é o principal vetor da tristeza parasitária bovina (babesiose e anaplasmose).
- Causa perda de peso de 0,5 a 1 kg/animal/mês em infestações pesadas.
- Custo estimado ao setor pecuário brasileiro: R$ 3,5 bilhões por ano.

CONTAGEM DE CARRAPATOS (MÉTODO PADRÃO):
- Contar carrapatos ingurgitados (>4,5 mm) no lado direito do animal, da linha do dorso até a barriga.
- Multiplique por 2 para estimar o total.
- Até 20 carrapatos por animal: baixa infestação.
- 20 a 50: média infestação, monitorar.
- Acima de 50: alta infestação, tratamento imediato necessário.

MOMENTOS ESTRATÉGICOS PARA TRATAMENTO:
- Final da seca (agosto/setembro): quebrar ciclo antes das chuvas.
- Início das chuvas (outubro/novembro): pico de infestação.
- Pós-desmama: animais mais vulneráveis à tristeza parasitária.
- Pré-estação de monta: garantir touros saudáveis.

ROTAÇÃO DE PRINCÍPIOS ATIVOS (evitar resistência):
- Amitraz: eficaz, mas resistência crescente. Não usar continuamente.
- Piretróides (cipermetrina, deltametrina): ampla resistência em muitas regiões.
- Organofosforados: alta eficácia, mas restrições ambientais.
- Lactonas macrocíclicas (ivermectina, doramectina): também atuam contra vermes.
- Fluazuron (Acatak): inibidor do crescimento, ideal para fêmeas e bezerros. Não mata adultos.

TESTE DE SUSCEPTIBILIDADE:
- Fazer teste de resistência a carrapaticidas a cada 2 anos.
- Serviço disponível em laboratórios estaduais e na Embrapa.

PERÍODO DE CARÊNCIA:
- Respeitar período de carência para abate (varia por produto, geralmente 7 a 28 dias).
- Registrar data e produto utilizado para fins de rastreabilidade.`
  },

  {
    titulo: 'Vermifugação estratégica em bovinos de corte',
    categoria: 'protocolo_sanitario',
    fonte: 'Embrapa / CRMV',
    tags: ['verme', 'vermifugação', 'helmintos', 'endo-parasita', 'OPG', 'recria'],
    conteudo: `Vermifugação estratégica para bovinos: quando e como fazer.

POR QUE ESTRATÉGICA:
- Vermifugação indiscriminada causa resistência anti-helmíntica.
- Tratamento estratégico (momentos certos) é mais eficaz e econômico.
- Animais jovens (até 2 anos) são os mais suscetíveis.

MOMENTOS ESTRATÉGICOS:
1. Desmama (7 a 8 meses): primeiro vermifugo de alto impacto.
2. Início da seca (maio/junho): reduzir carga parasitária antes do período crítico.
3. Final da seca, antes das chuvas (setembro): quebrar ciclo na pastagem.
4. Início das chuvas (novembro): pico de larvas nas pastagens.
5. Pré-parto das vacas (60 dias antes de parir): "periparturient rise", vacas ficam mais suscetíveis.

CATEGORIAS PRIORITÁRIAS:
- Bezerros de 6 a 18 meses: fase mais crítica, vermifugar com maior frequência.
- Vacas no pré-parto: obrigatório.
- Touros na pré-estação: garantir performance reprodutiva.
- Animais adultos saudáveis em boas pastagens: menor prioridade.

DIAGNÓSTICO (OPG — ovos por grama de fezes):
- OPG < 200: baixa infestação, não necessita tratamento imediato.
- OPG 200 a 500: moderada, tratar animais em piora.
- OPG > 500: alta infestação, tratar todo o lote.
- Exame disponível em laboratórios veterinários locais.

PRINCÍPIOS ATIVOS E ROTAÇÃO:
- Benzimidazóis (albendazol, fenbendazol): eficaz contra larvas L3.
- Levamisol: atua em adultos e L4. Bom associar com benzimidazol.
- Lactonas macrocíclicas (ivermectina, moxidectina): amplo espectro, também carrapato e berne.
- Monepantel e derquantel: alternativas para resistência avançada.
- Nunca usar o mesmo princípio ativo por mais de 2 anos consecutivos.`
  },

  // ── GESTÃO ────────────────────────────────────────────────────
  {
    titulo: 'Categorias do rebanho bovino — classificação e gestão por lote',
    categoria: 'boas_praticas',
    fonte: 'Embrapa / ABIEC',
    tags: ['categoria', 'bezerro', 'bezerra', 'novilha', 'vaca', 'boi', 'garrote', 'touro', 'classificação'],
    conteudo: `Classificação de categorias em rebanhos bovinos de corte.

MACHOS:
- Bezerros 0-8m: machos do nascimento até 8 meses. Em aleitamento ou recém-desmamados.
- Bezerros 8-12m: pós-desmama até completar 1 ano. Fase de maior vulnerabilidade à tristeza parasitária.
- Garrotes 13-24m: machos de 1 a 2 anos, em recria. Fase de maior ganho de peso relativo.
- Garrotes 25-36m: machos de 2 a 3 anos, em recria ou terminação.
- Bois 25-36m: machos castrados de 2 a 3 anos, destinados ao abate.
- Bois acima de 36m: machos castrados acima de 3 anos, geralmente em terminação final.
- Touros PO: reprodutores. Selecionar por DEPs (Diferenças Esperadas na Progênie).

FÊMEAS:
- Bezerras 0-2m: fêmeas do nascimento até 2 meses.
- Bezerras 3-8m: em aleitamento ou pós-desmama precoce.
- Bezerras 9-12m: pós-desmama, em recria.
- Novilhas 13-24m: fêmeas de 1 a 2 anos. Definir quais serão matrizes.
- Novilhas 25-36m: próximas da primeira monta. Peso ideal de cobertura: 300 a 330 kg para Nelore.
- Vacas solteiras: fêmeas adultas sem bezerro ao pé. Verificar prenhez.
- Vacas paridas: fêmeas com bezerro ao pé. Maior demanda nutricional.
- Vacas prenhas: gestantes confirmadas por diagnóstico. Atenção especial à nutrição.

GESTÃO DE LOTES:
- Separar animais por categoria para facilitar o manejo nutricional e sanitário.
- Não misturar bezerros recém-desmamados com garrotes grandes (competição no cocho).
- Lote de descarte: identificar vacas velhas (mais de 10 anos), com problemas de casco, baixa produção.
- Rotação de touros: trocar touros entre propriedades a cada 3 anos para evitar consanguinidade.`
  }

]

async function seed() {
  console.log(`Iniciando seed de ${documentos.length} documentos...\n`)
  let ok = 0, erro = 0

  for (const doc of documentos) {
    try {
      process.stdout.write(`Gerando embedding: ${doc.titulo.substring(0,50)}... `)
      const emb = await embedding(`${doc.titulo}\n\n${doc.conteudo}`)

      const { error } = await sb.from('knowledge_base').insert({
        titulo: doc.titulo,
        conteudo: doc.conteudo,
        categoria: doc.categoria,
        fonte: doc.fonte,
        tags: doc.tags,
        embedding: emb,
        ativo: true
      })

      if (error) throw error
      console.log('✅')
      ok++
      // Pausa para não estourar rate limit da OpenAI
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.log('❌', err.message)
      erro++
    }
  }

  console.log(`\nConcluído: ${ok} inseridos, ${erro} erros`)
}

seed().catch(console.error)
