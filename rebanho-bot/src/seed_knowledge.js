// seed_knowledge.js — Popular knowledge_base com documentos técnicos de pecuária
// Executar: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... OPENAI_API_KEY=... node seed_knowledge.js

const https = require('https')

// Verificar variáveis antes de qualquer coisa
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('❌ Faltam variáveis de ambiente:')
  if (!SUPABASE_URL) console.error('  - SUPABASE_URL')
  if (!SUPABASE_KEY) console.error('  - SUPABASE_SERVICE_KEY')
  if (!OPENAI_KEY) console.error('  - OPENAI_API_KEY')
  process.exit(1)
}

console.log('✅ Variáveis OK')
console.log('   Supabase:', SUPABASE_URL)

// HTTP request sem axios (evita dependências)
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
        catch (e) { resolve({ status: res.statusCode, data }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// Gerar embedding via OpenAI
async function gerarEmbedding(texto) {
  const body = JSON.stringify({ model: 'text-embedding-3-small', input: texto })
  const res = await request({
    hostname: 'api.openai.com',
    path: '/v1/embeddings',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body)
  if (res.status !== 200) throw new Error(`OpenAI erro ${res.status}: ${JSON.stringify(res.data)}`)
  return res.data.data[0].embedding
}

// Inserir no Supabase via REST API direta (sem SDK)
async function inserir(doc) {
  const body = JSON.stringify(doc)
  const res = await request({
    hostname: new URL(SUPABASE_URL).hostname,
    path: '/rest/v1/knowledge_base',
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Prefer': 'return=minimal'
    }
  }, body)
  if (res.status !== 201) throw new Error(`Supabase erro ${res.status}: ${JSON.stringify(res.data)}`)
  return true
}

const documentos = [
  {
    titulo: 'Índices zootécnicos de referência — rebanho bovino de corte',
    categoria: 'indice_zootecnico',
    fonte: 'Embrapa Gado de Corte',
    tags: ['índices', 'referência', 'mortalidade', 'natalidade', 'produtividade'],
    conteudo: `Índices zootécnicos de referência para bovinos de corte no Brasil Central (Cerrado):

MORTALIDADE:
- Bezerros até 1 ano: até 5% considerado normal. Acima de 8%: alerta. Acima de 12%: crítico.
- Adultos: até 2% ao ano é normal. Acima de 3%: investigar causas.
- Causas mais comuns: diarreia neonatal (primeiros 30 dias), carência mineral (cobre, selênio), pneumonia, tristeza parasitária.

NATALIDADE:
- Taxa ideal: acima de 80% para sistemas de ciclo completo.
- Abaixo de 65%: problema de manejo reprodutivo ou nutricional.
- Intervalo entre partos ideal: 12 meses. Acima de 14 meses: problema.

GANHO DE PESO:
- Bezerros a pasto: 0,5 a 0,7 kg/dia considerado bom.
- Garrotes em recria intensiva: 0,8 a 1,2 kg/dia.

RELAÇÃO TOURO:VACA:
- Monta natural: 1 touro para 25-30 vacas.
- Touros jovens (2 anos): não ultrapasse 15 vacas.

DESFRUTE:
- Taxa de desfrute ideal para corte: 18 a 22% ao ano.`
  },
  {
    titulo: 'Mortalidade de bezerros — causas, diagnóstico e prevenção',
    categoria: 'protocolo_sanitario',
    fonte: 'Embrapa / MAPA',
    tags: ['bezerro', 'mortalidade', 'diarreia', 'neonatal', 'prevenção'],
    conteudo: `Mortalidade de bezerros: principais causas e como agir.

DIARREIA NEONATAL (0 a 30 dias):
Principal causa de morte. Causas: E. coli, Rotavírus, Coronavírus.
Sinais: fezes líquidas amareladas, desidratação, fraqueza.
Ação: reidratação oral (2 a 4 litros/dia), isolamento.
Prevenção: vacinação da vaca gestante 2 meses antes do parto, colostro nas primeiras 6 horas.

TRISTEZA PARASITÁRIA (Babesiose/Anaplasmose):
Mais comum em bezerros de 6 a 12 meses após saírem de área com carrapatos.
Sinais: febre acima de 40°C, anemia, urina vermelha.
Prevenção: não mover animais jovens abruptamente, controle de carrapatos.

CARÊNCIA MINERAL:
Cobre e selênio são os mais comuns no Cerrado.
Sinais de carência de cobre: pelagem opaca, baixo desenvolvimento.
Prevenção: suplementação mineral correta conforme análise de solo.`
  },
  {
    titulo: 'Manejo de pastagens — taxa de lotação e rotação de pasto',
    categoria: 'manejo',
    fonte: 'Embrapa Gado de Corte',
    tags: ['pastagem', 'lotação', 'rotação', 'pasto', 'UA'],
    conteudo: `Manejo de pastagens para bovinos de corte.

TAXA DE LOTAÇÃO:
- Brachiaria brizantha (Marandu): 1 a 2 UA/ha extensivo, 3 a 5 UA/ha intensivo.
- Panicum maximum (Mombaça): 2 a 4 UA/ha com manejo adequado.

PERÍODO DE DESCANSO:
- Brachiaria: 30 a 35 dias no verão, 60 a 90 dias no inverno.
- Saída dos animais: quando pasto atingir 25 a 30 cm de altura residual.

SINAIS DE SUPERLOTAÇÃO:
- Pastagem abaixo de 15 cm por período prolongado.
- Solo descoberto em mais de 30% da área.
- Aumento de invasoras.
- Perda de peso sem causa sanitária aparente.`
  },
  {
    titulo: 'Desmama de bezerros — idade, técnicas e manejo',
    categoria: 'manejo',
    fonte: 'Embrapa Gado de Corte',
    tags: ['desmama', 'bezerro', 'bezerra', 'recria', 'estresse'],
    conteudo: `Desmama de bezerros: quando e como fazer corretamente.

IDADE IDEAL:
- Desmama convencional: 7 a 8 meses de idade.
- Desmama precoce: 60 a 90 dias, para melhorar condição corporal da vaca.
- Peso mínimo ideal: 160 a 180 kg para raças zebuínas.

TÉCNICAS:
- Separação total e imediata: mais estressante mas prática.
- Desmama em cerca: bezerro e vaca separados por cerca por 7 dias, depois separação total.
- Anteparo nasal: permite convívio mas impede amamentação.

MANEJO PÓS-DESMAMA (primeiros 30 dias críticos):
- Manter bezerros em pasto de qualidade.
- Não misturar com animais muito mais velhos.
- Perda de até 5 kg no primeiro mês é normal. Acima de 10 kg: avaliar.`
  },
  {
    titulo: 'Estação de monta — planejamento e manejo reprodutivo',
    categoria: 'reproducao',
    fonte: 'Embrapa Gado de Corte',
    tags: ['reprodução', 'monta', 'touro', 'prenhez', 'iatf', 'estação'],
    conteudo: `Estação de monta: como planejar para maximizar natalidade.

DURAÇÃO:
- 60 a 90 dias: concentra partos e facilita manejo.
- Melhor época no Cerrado: outubro a dezembro, partos entre julho e setembro.

CONDIÇÃO CORPORAL DAS VACAS:
- Escore mínimo para entrar na monta: 3,0 (escala 1-5).
- Abaixo de 2,5: vaca dificilmente ciclará.

SELEÇÃO DOS TOUROS:
- Exame andrológico obrigatório 60 dias antes da monta.
- Circunferência escrotal mínima: 34 cm para Nelore de 2 anos.
- Proporção: 1 touro para 25 vacas (3+ anos), 1 para 15 (touros jovens).

IATF:
- Taxa de prenhez de 50 a 65% em 10 dias.
- Exige vacas em boa condição corporal.`
  },
  {
    titulo: 'Suplementação mineral para bovinos de corte — Cerrado',
    categoria: 'nutricao',
    fonte: 'Embrapa Cerrados',
    tags: ['mineral', 'suplementação', 'sal', 'cobre', 'fósforo', 'Cerrado'],
    conteudo: `Suplementação mineral para bovinos no Cerrado brasileiro.

DEFICIÊNCIAS MAIS COMUNS:
- Fósforo: deficiência generalizada. Sintomas: apetite depravado (comer ossos, madeira).
- Cobre: pelagem opaca, despigmentada, baixo desenvolvimento.
- Selênio: músculo branco em bezerros.

CONSUMO ESPERADO:
- Consumo ideal: 60 a 100 g/animal/dia de mineral completo.
- Abaixo de 30 g: analisar palatabilidade, adicionar mais sal.
- Acima de 150 g: reduzir sal na formulação.

SUPLEMENTAÇÃO PROTÉICA NA SECA:
- Novilhos em recria: 300 a 500 g/animal/dia com 30 a 40% proteína bruta.
- Vacas gestantes na seca: 500 g a 1 kg/animal/dia.
- Ureia: não exceder 1% da matéria seca total. Risco de intoxicação.`
  },
  {
    titulo: 'Registros de rebanho — como e por que registrar corretamente',
    categoria: 'boas_praticas',
    fonte: 'ABIEC / Embrapa',
    tags: ['registro', 'controle', 'gestão', 'mapa', 'rebanho'],
    conteudo: `Por que registrar movimentações do rebanho corretamente.

IMPORTÂNCIA:
- Permite calcular índices zootécnicos reais (mortalidade, natalidade).
- Base para decisões de descarte, compra e venda.
- Rastreabilidade exigida pelo mercado exportador.
- Acesso a crédito rural.

O QUE REGISTRAR:
NASCIMENTO: data, categoria, peso ao nascer se possível.
MORTE: data, categoria, causa provável.
COMPRA: data, quantidade, categoria, procedência, GTA.
VENDA: data, quantidade, categoria, destino, GTA.

COMO CALCULAR MORTALIDADE:
Mortalidade (%) = (mortes / média do rebanho) × 100.
Exemplo: 5 mortes em 250 animais = 2%.

SINAIS DE ALERTA:
- Divergência entre contagem física e registro.
- Aumento súbito de mortes: notificar veterinário.`
  },
  {
    titulo: 'Controle de carrapatos em bovinos — manejo integrado',
    categoria: 'protocolo_sanitario',
    fonte: 'MAPA / Embrapa',
    tags: ['carrapato', 'tristeza', 'parasita', 'controle', 'carrapaticida'],
    conteudo: `Controle estratégico de carrapatos em bovinos.

CONTAGEM (MÉTODO PADRÃO):
- Contar carrapatos ingurgitados (>4,5 mm) no lado direito.
- Até 20: baixa infestação. 20 a 50: média. Acima de 50: alta, tratar imediatamente.

MOMENTOS ESTRATÉGICOS:
- Final da seca (agosto/setembro): quebrar ciclo antes das chuvas.
- Início das chuvas (outubro/novembro): pico de infestação.
- Pós-desmama: animais mais vulneráveis à tristeza parasitária.

ROTAÇÃO DE PRINCÍPIOS ATIVOS:
- Amitraz, piretróides, organofosforados, lactonas macrocíclicas.
- Nunca usar o mesmo produto por mais de 2 anos consecutivos.
- Fazer teste de resistência a cada 2 anos.`
  },
  {
    titulo: 'Vermifugação estratégica em bovinos de corte',
    categoria: 'protocolo_sanitario',
    fonte: 'Embrapa / CRMV',
    tags: ['verme', 'vermifugação', 'helmintos', 'OPG', 'recria'],
    conteudo: `Vermifugação estratégica: quando e como fazer.

MOMENTOS ESTRATÉGICOS:
1. Desmama (7 a 8 meses): primeiro vermifugo de alto impacto.
2. Início da seca (maio/junho): reduzir carga antes do período crítico.
3. Final da seca (setembro): quebrar ciclo antes das chuvas.
4. Pré-parto das vacas: obrigatório (periparturient rise).

CATEGORIAS PRIORITÁRIAS:
- Bezerros de 6 a 18 meses: fase mais crítica.
- Vacas no pré-parto: obrigatório.

DIAGNÓSTICO OPG:
- OPG < 200: baixa infestação. OPG > 500: tratar todo o lote.

ROTAÇÃO:
- Nunca usar o mesmo princípio ativo por mais de 2 anos consecutivos.`
  },
  {
    titulo: 'Categorias do rebanho bovino — classificação e gestão por lote',
    categoria: 'boas_praticas',
    fonte: 'Embrapa / ABIEC',
    tags: ['categoria', 'bezerro', 'novilha', 'vaca', 'boi', 'garrote', 'touro'],
    conteudo: `Classificação de categorias em rebanhos bovinos de corte.

MACHOS:
- Bezerros 0-8m: do nascimento até 8 meses.
- Bezerros 8-12m: pós-desmama até 1 ano. Maior vulnerabilidade à tristeza parasitária.
- Garrotes 13-24m: 1 a 2 anos, em recria. Maior ganho de peso relativo.
- Garrotes 25-36m: 2 a 3 anos, recria ou terminação.
- Bois 25-36m: castrados de 2 a 3 anos, destinados ao abate.
- Bois acima de 36m: castrados acima de 3 anos, terminação final.
- Touros PO: reprodutores. Selecionar por DEPs.

FÊMEAS:
- Bezerras 0-2m, 3-8m, 9-12m: fases de cria.
- Novilhas 13-24m e 25-36m: próximas da primeira monta. Peso ideal: 300 a 330 kg.
- Vacas solteiras: verificar prenhez.
- Vacas paridas: maior demanda nutricional.
- Vacas prenhas: atenção especial à nutrição.

GESTÃO DE LOTES:
- Separar animais por categoria para manejo nutricional e sanitário adequado.
- Não misturar bezerros recém-desmamados com garrotes grandes.`
  }
]

async function seed() {
  console.log(`\nIniciando seed de ${documentos.length} documentos...\n`)
  let ok = 0, erro = 0

  for (const doc of documentos) {
    try {
      process.stdout.write(`Processando: ${doc.titulo.substring(0, 50)}... `)
      const emb = await gerarEmbedding(`${doc.titulo}\n\n${doc.conteudo}`)
      await inserir({ ...doc, embedding: emb, ativo: true })
      console.log('✅')
      ok++
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.log('❌', err.message)
      erro++
    }
  }

  console.log(`\nConcluído: ${ok} inseridos, ${erro} erros`)
}

seed().catch(console.error)
