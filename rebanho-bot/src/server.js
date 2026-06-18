require('dotenv').config()
const dbFazendas = require('./db_fazendas')

// ─── Módulos lazy (carregados sob demanda) ──────────────────
let _agenteConsulta = null
function getAgenteConsulta() {
  if (!_agenteConsulta) _agenteConsulta = require('./agente_consulta')
  return _agenteConsulta
}
let _agenteLogs = null
function getAgenteLogs() {
  if (!_agenteLogs) _agenteLogs = require('./agente_logs')
  return _agenteLogs
}

// v1781741416

const express = require('express')
const twilio = require('twilio')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { transcreverAudio } = require('./transcricao')
const { extrairDadosRebanho, extrairComplemento, extrairMovimentacao, extrairMovimentacaoMultipla, detectarTipoRegistro, agentRoteador, agentConsulta, salvarExemploConfirmado, gerarResumoWhatsApp, extrairPeso } = require('./extracao')


// Helper: garantir string na transcrição
function toStr(v) { return typeof v === 'string' ? v : (v?.text || v?.transcription || (v ? JSON.stringify(v) : '') || '') }
// Tipos de movimentação de curral que exigem peso obrigatório
const TIPOS_EXIGEM_PESO = ['entrada_compra', 'saida_venda', 'mudanca_categoria']

// Mapeamento de label do menu para tipo interno
const MENU_TIPO_MAP = {
  '1': { tipo: 'nascimento', label: 'Nascimentos', interno: 'entrada_nascimento' },
  '2': { tipo: 'morte',      label: 'Mortes',      interno: 'saida_morte' },
  '3': { tipo: 'compra',     label: 'Compras',     interno: 'entrada_compra' },
  '4': { tipo: 'venda',      label: 'Vendas',      interno: 'saida_venda' },
  '5': { tipo: 'troca',      label: 'Troca de categoria', interno: 'mudanca_categoria' },
  '6': { tipo: 'mapa',       label: 'Fechamento mensal',  interno: 'mapa' },
}

// Categorias relevantes por tipo de movimentação
// Categorias de manejo — Grupo Ricci (atualizadas)
const TODAS_CATS = [
  '1.1 Bezerros 0-2m','1.2 Bezerros 3-8m','1.3 Garrotes 9-12m','1.4 Garrotes 13-24m',
  '1.5 Bois 25-36m','1.6 Bois acima 36m','1.7 Touros PO',
  '2.1 Bezerras 0-2m','2.2 Bezerras 3-8m','2.3 Bezerras 9-12m',
  '2.4 Novilhas 13-24m','2.5 Novilhas 25-36m',
  '2.6 Vacas solteiras','2.7 Vacas paridas','2.8 Vacas prenhas'
]
const CATS_NASCIMENTO = ['1.1 Bezerros 0-2m','2.1 Bezerras 0-2m']
const CATS_ABATE     = ['1.5 Bois 25-36m','1.6 Bois acima 36m','2.6 Vacas solteiras','2.7 Vacas paridas']

const CATEGORIAS_POR_TIPO = {
  nascimento:      CATS_NASCIMENTO,
  morte:           TODAS_CATS,
  compra:          TODAS_CATS,
  venda:           TODAS_CATS,
  abate:           CATS_ABATE,
  troca_categoria: TODAS_CATS,
  transferencia:   TODAS_CATS,
  desmama:         ['1.1 Bezerros 0-2m','1.2 Bezerros 3-8m','2.1 Bezerras 0-2m','2.2 Bezerras 3-8m'],
  fechamento:      TODAS_CATS,
  troca:           TODAS_CATS,
  mapa:            ['1.1','1.2','1.3','1.4','1.5','1.6','1.7','2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8'],
}
let _rag = null
function getRag() { if (!_rag) _rag = require('./rag'); return _rag }
const { salvarRebanho, buscarResumoMensal, buscarResumoPorLote } = require('./supabase')

const app = express()
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(express.static(path.join(__dirname)))

// ─── Middleware de logging completo ──────────────────────────────────────────
app.use(function(req, res, next) {
  const inicio = Date.now()
  const ts = new Date().toISOString()

  // Log da requisição
  const bodyLog = req.body && Object.keys(req.body).length
    ? JSON.stringify(req.body).substring(0, 500)
    : ''
  console.log('[REQ]', ts, req.method, req.path,
    req.query && Object.keys(req.query).length ? JSON.stringify(req.query) : '',
    bodyLog ? '| body: ' + bodyLog : ''
  )

  // Interceptar o response para logar
  const origJson = res.json.bind(res)
  const origSend = res.send.bind(res)

  function logResp(body) {
    const ms = Date.now() - inicio
    const bodyStr = typeof body === 'object' ? JSON.stringify(body).substring(0, 300) : String(body || '').substring(0, 300)
    console.log('[RES]', new Date().toISOString(), req.method, req.path, res.statusCode, ms + 'ms',
      bodyStr ? '| ' + bodyStr : ''
    )
  }

  res.json = function(body) { logResp(body); return origJson(body) }
  res.send = function(body) { logResp(body); return origSend(body) }

  next()
})

let _twilioClient = null
function getTwilioClient() {
  if (!_twilioClient) _twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  )
  return _twilioClient
}

let _supabaseServer = null
function getSupabase() {
  if (!_supabaseServer) _supabaseServer = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { global: { WebSocket: require('ws') } }
  )
  return _supabaseServer
}
const supabase = new Proxy({}, {
  get(_, prop) { return getSupabase()[prop] }
})


// ─── Menu cascata numerado ────────────────────────────────────────────────────
async function enviarMenuNumerico(de, titulo, opcoes, rodape) {
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']
  const linhas = opcoes.map((o, i) => (emojis[i] || (i+1)+'.') + '  ' + o)
  await enviarMensagem(de, '*' + titulo + '*\n\n' + linhas.join('\n') + '\n\n' + (rodape || '_Responda com o número._'))
}
function parsearOpcao(texto, total) {
  const n = parseInt((texto || '').trim())
  return (!isNaN(n) && n >= 1 && n <= total) ? n - 1 : null
}
// ─── Sessões multi-etapa ──────────────────────────────────────────────────────
// Estrutura: { dados, etapa, ts }
// Etapas legadas (mapa livre): 'periodo' | 'existencia' | 'movimentacoes' | 'confirmacao'
// Etapas fluxo guiado:        'menu_inicial' | 'local_data' | 'categorias' | 'peso_lote' | 'confirmacao_guiada'
const sessoes = {}
const TTL = 15 * 60 * 1000

function setSessao(de, dados, etapa) {
  sessoes[de] = { dados, etapa, ts: Date.now() }
  setTimeout(() => { delete sessoes[de] }, TTL)
}

function limparSessao(de) { delete sessoes[de] }

// ─── Detecção de saudação ─────────────────────────────────────────────────────
function eSaudacao(texto) {
  if (!texto) return false
  const t = texto.trim().toLowerCase()
  if (t.length > 30) return false
  const saudacoes = ['oi','olá','ola','bom dia','boa tarde','boa noite','boa','e aí','e ai',
    'eai','hey','hello','hi','tudo bem','tudo bom','opa','salve','fala','alô','alo']
  return saudacoes.some(s => t === s || t.startsWith(s + ' ') || t.startsWith(s + ','))
}

// ─── Fluxo guiado: enviar menu inicial ───────────────────────────────────────
async function enviarMenuInicial(de, usuario) {
  const nome = usuario && usuario.nome ? ', ' + usuario.nome.split(' ')[0] : ''
  try {
    const { data: fazendas } = await getSupabase().from('fazendas').select('id,nome').eq('ativo', true).order('nome')
    if (fazendas && fazendas.length) {
      setSessao(de, { _guiado: true, _fazendasMenu: fazendas }, 'menu_inicial')
      await enviarMenuNumerico(de,
        'Olá' + nome + '! 👋 Em qual fazenda ocorreu?',
        fazendas.map(function(f) { return f.nome })
      )
      return
    }
  } catch(e) {}
  setSessao(de, { _guiado: true }, 'menu_inicial')
  await enviarMenuNumerico(de, 'Olá' + nome + '! 👋 O que deseja registrar hoje?', ['Nascimentos','Mortes','Compras','Vendas','Troca de categoria','Fechamento mensal'])
}

// ─── Perguntar Retiro, Lote e Tipo — menu cascata numerado ───────────────────
async function perguntarLoteTipo(de, dados) {
  try {
    const fazObj = await dbFazendas.resolverFazenda(dados.fazenda || 'Grupo Ricci')
    if (fazObj) {
      const { data: retiros } = await getSupabase().from('subdivisoes').select('id,nome,tipo').eq('fazenda_id', fazObj.id).eq('ativo', true).order('nome')
      if (retiros && retiros.length) {
        const s = sessoes[de]; if (s) s.dados._subsMenu = retiros
        await enviarMenuNumerico(de, '📍 ' + fazObj.nome + ' — Em qual retiro?', retiros.map(function(r) { return r.nome + ' (' + r.tipo + ')' }))
        return
      }
    }
  } catch(e) {}
  await enviarMensagem(de, 'Informe o *retiro*, *lote* e *tipo de animal*.\n\n_Ex: "Pasto 01, Lote 3, Nelore" · "Piquete 2, Lote Recria, Cruzado"_\n\n_Tipos: Nelore, Angus, Cruzado, Girolando, Outros_')
}
async function perguntarLoteAposSub(de, dados, fazendaId) {
  try {
    const lotes = await dbFazendas.listarLotes(fazendaId)
    if (lotes && lotes.length) {
      const s = sessoes[de]; if (s) s.dados._lotesMenu = lotes
      await enviarMenuNumerico(de, 'Qual lote no retiro *' + dados.subdivisao_nome + '*?', lotes.map(function(l) { return l.nome }), '_Ou digite o nome do lote._')
      return
    }
  } catch(e) {}
  await enviarMensagem(de, 'Qual o *lote* e *tipo de animal*?\n\n_Ex: "Lote 3, Nelore"_')
}

// ─── Extrair subdivisão, lote e tipo de animal via GPT ──────────────────────
async function extrairLoteTipo(texto, lotesDisponiveis, subsDisponiveis) {
  const t = (texto || '').toLowerCase().trim()

  if (t.includes('pular') || t.includes('skip') || t.includes('não sei') || t.includes('nao sei') || t.length < 2) {
    return { subdivisao: null, lote: null, tipo_animal: null }
  }

  try {
    const axios = require('axios')

    const subsStr = subsDisponiveis?.length
      ? 'Retiros disponíveis: ' + subsDisponiveis.map(s => s.nome).join(', ')
      : 'Retiros: Pasto 01, Pasto 02, Piquete 1, Piquete 2'

    const lotesStr = lotesDisponiveis?.length
      ? 'Lotes disponíveis: ' + lotesDisponiveis.map(l => l.nome).join(', ')
      : 'Lotes: Lote 1, Lote 2, Lote Engorda, Lote Recria, Lote Cria'

    const prompt = `Extraia o retiro, o lote e o tipo de animal do texto a seguir.
Hierarquia: Fazenda > Retiro (Pasto/Piquete/Talhão) > Lote > Tipo de animal

${subsStr}
${lotesStr}
Tipos de animal válidos: Nelore, Angus, Cruzado, Girolando, Outros

Texto (pode conter erros de transcrição de áudio): "${texto}"

Retorne APENAS JSON válido, sem markdown:
{"subdivisao": "nome exato da subdivisao ou null", "lote": "nome exato do lote ou null", "tipo_animal": "tipo exato ou null"}

Exemplos:
- "confinamento, lote 3, nelore" → {"subdivisao": "Confinamento", "lote": "Lote 3", "tipo_animal": "Nelore"}
- "pasto 01, lote recria, cruzado" → {"subdivisao": "Pasto 01", "lote": "Lote Recria", "tipo_animal": "Cruzado"}
- "piquete 2, lote engorda" → {"subdivisao": "Piquete 2", "lote": "Lote Engorda", "tipo_animal": null}
- "não sei" → {"subdivisao": null, "lote": null, "tipo_animal": null}`

    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        max_tokens: 150,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 8000 }
    )

    const raw = resp.data.choices[0].message.content.trim()
    const clean = raw.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)
    console.log(`[extrairLoteTipo] "${texto}" → sub:${result.subdivisao} lote:${result.lote} tipo:${result.tipo_animal}`)
    return {
      subdivisao: result.subdivisao || null,
      lote: result.lote || null,
      tipo_animal: result.tipo_animal || null
    }
  } catch (err) {
    console.log('[extrairLoteTipo] Erro GPT:', err.message, '— fallback regex')
    const tipos = ['nelore', 'angus', 'cruzado', 'girolando']
    const tipo_animal = tipos.find(tp => t.includes(tp))
    const matchSub = t.match(/(?:pasto|confinamento|piquete|curral)\s*\d*/i)
    const matchLote = t.match(/lote\s+[\w]+/i)
    return {
      subdivisao: matchSub ? matchSub[0].trim().replace(/^\w/, c => c.toUpperCase()) : null,
      lote: matchLote ? matchLote[0].replace(/^\w/, c => c.toUpperCase()) : null,
      tipo_animal: tipo_animal ? tipo_animal.charAt(0).toUpperCase() + tipo_animal.slice(1) : null
    }
  }
}

// ─── Fluxo guiado: processar cada etapa ──────────────────────────────────────
async function processarFluxoGuiado(de, texto, dados, etapa) {
  const resposta = (texto || '').trim()
  const respostaLower = resposta.toLowerCase()

  if (etapa === 'menu_inicial') {
    const _fm  = dados._fazendasMenu   // step 1: lista de fazendas
    const _es  = dados._etapaMenu      // 'fazenda' | 'entrada_saida' | 'tipo'

    // ── Step 1: selecionar fazenda ──────────────────────────────────────────
    if (!dados.fazenda && _fm) {
      const idx = parsearOpcao(resposta, _fm.length)
      if (idx === null) {
        await enviarMenuNumerico(de, 'Responda com o número da fazenda:', _fm.map(function(f) { return f.nome }))
        return
      }
      const faz = _fm[idx]
      const nd = Object.assign({}, dados, { fazenda: faz.nome, fazenda_id: faz.id, _fazendasMenu: null, _etapaMenu: 'entrada_saida' })
      setSessao(de, nd, 'menu_inicial')
      await enviarMenuNumerico(de, '📍 *' + faz.nome + '*\n\nEntrada ou saída?', ['Entrada  (nascimento / compra)', 'Saída  (morte / abate / venda)', 'Transferência / Troca de categoria'])
      return
    }

    // ── Step 2: entrada ou saída ────────────────────────────────────────────
    if (_es === 'entrada_saida') {
      const idx = parsearOpcao(resposta, 3)
      if (idx === null) {
        await enviarMenuNumerico(de, 'Responda com o número:', ['Entrada  (nascimento / compra)', 'Saída  (morte / abate / venda)', 'Transferência / Troca de categoria'])
        return
      }
      const nd = Object.assign({}, dados, { _etapaMenu: 'tipo', _tipoGrupo: idx === 0 ? 'entrada' : idx === 1 ? 'saida' : 'neutro' })
      setSessao(de, nd, 'menu_inicial')
      if (idx === 0) {
        await enviarMenuNumerico(de, 'Qual tipo de entrada?', ['Nascimento', 'Compra'])
      } else if (idx === 1) {
        await enviarMenuNumerico(de, 'Qual tipo de saída?', ['Morte', 'Abate', 'Venda'])
      } else {
        await enviarMenuNumerico(de, 'Qual operação?', ['Transferência entre lotes', 'Troca de categoria', 'Desmama'])
      }
      return
    }

    // ── Step 3: tipo específico ─────────────────────────────────────────────
    if (_es === 'tipo') {
      const grupo = dados._tipoGrupo
      const mapEntrada  = [{tipo:'nascimento', label:'Nascimentos'}, {tipo:'compra', label:'Compras'}]
      const mapSaida    = [{tipo:'morte', label:'Mortes'}, {tipo:'abate', label:'Abates'}, {tipo:'venda', label:'Vendas'}]
      const mapNeutro   = [{tipo:'transferencia', label:'Transferência'}, {tipo:'troca_categoria', label:'Troca de categoria'}, {tipo:'desmama', label:'Desmama'}]
      const lista = grupo === 'entrada' ? mapEntrada : grupo === 'saida' ? mapSaida : mapNeutro
      const idx = parsearOpcao(resposta, lista.length)
      if (idx === null) {
        await enviarMenuNumerico(de, 'Responda com o número:', lista.map(function(o) { return o.label }))
        return
      }
      const opcao = lista[idx]
      const nd = Object.assign({}, dados, {
        _etapaMenu: null, _tipoGrupo: null, _fazendasMenu: null,
        tipo_guiado: opcao.tipo, tipo_interno: opcao.tipo, label_tipo: opcao.label, _guiado: true
      })
      setSessao(de, nd, 'local_data')
      await enviarMensagem(de,
        '✅ *' + opcao.label + '* — *' + nd.fazenda + '*\n\nQual a *data*?\n_Ex: hoje · dia 17 · 17 de junho_'
      )
      return
    }

    // Fallback
    await enviarMenuNumerico(de, 'Responda com o número da fazenda:', (dados._fazendasMenu || []).map(function(f) { return f.nome }))
    return
  }

  if (etapa === 'local_data') {
    await enviarMensagem(de, '_Processando local e data..._')
    try {
      // Resolver "hoje" / "ontem" antes de chamar o GPT
      const agora = new Date()
      let respostaData = resposta
      const rLower = (resposta || '').toLowerCase().trim()
      if (rLower === 'hoje' || rLower === 'today') {
        respostaData = agora.getDate() + ' de ' + ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][agora.getMonth()] + ' de ' + agora.getFullYear()
      } else if (rLower === 'ontem' || rLower === 'yesterday') {
        const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1)
        respostaData = ontem.getDate() + ' de ' + ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][ontem.getMonth()] + ' de ' + ontem.getFullYear()
      }
      const extraido = await extrairDadosRebanho(respostaData)
      // Manter fazenda escolhida no menu — não sobrescrever com extração do GPT
      let fazendaNome = dados.fazenda || extraido.fazenda || null
      if (!dados.fazenda && extraido.fazenda) {
        try {
          const fazObj = await dbFazendas.resolverFazenda(extraido.fazenda)
          if (fazObj) fazendaNome = fazObj.nome
        } catch(e) {}
      }
      const novosDados = Object.assign({}, dados, {
        fazenda: fazendaNome,
        lote_nome: extraido.lote_nome || null,
        dia: extraido.dia || null,
        mes: extraido.mes || null,
        ano: extraido.ano || new Date().getFullYear(),
        _transcricaoLocalData: resposta,
      })
      setSessao(de, novosDados, 'lote_tipo')
      await perguntarLoteTipo(de, novosDados)
    } catch(e) {
      const ia = await tentarEntenderComIA(de, resposta, dados, 'Preciso saber: local/fazenda e data do registro')
      if (ia.entendeu && ia.dados_extraidos) {
        const novosDados = Object.assign({}, dados, ia.dados_extraidos)
        setSessao(de, novosDados, 'lote_tipo')
        await perguntarLoteTipo(de, novosDados)
      } else {
        const msgIA = ia.resposta || '_Não entendi. Tente falar o local e a data, ex: "Retiro Aliança, dia 10 de junho"._'
        await enviarMensagem(de, msgIA)
      }
      return
    }
    return
  }

  // ── Etapa: lote e tipo de animal ──────────────────────────
  if (etapa === 'lote_tipo') {
    // ── Cascata numerada ──
    var _sm = dados._subsMenu, _lm = dados._lotesMenu
    var _is = _sm ? parsearOpcao(resposta, _sm.length) : null
    if (_is !== null && _sm) {
      var _sub = _sm[_is]
      var _nd1 = Object.assign({}, dados, { subdivisao_nome: _sub.nome, subdivisao_id: _sub.id, _subsMenu: null })
      setSessao(de, _nd1, 'lote_tipo')
      try { var _f1 = await dbFazendas.resolverFazenda(dados.fazenda); if (_f1) { await perguntarLoteAposSub(de, _nd1, _f1.id); return } } catch(e2) {}
      await enviarMensagem(de, 'Qual lote no ' + _sub.nome + '? Ex: "Lote 3, Nelore"'); return
    }
    var _il = _lm ? parsearOpcao(resposta, _lm.length) : null
    if (_il !== null && _lm) {
      var _lote = _lm[_il]
      var _nd2 = Object.assign({}, dados, { lote_nome: _lote.nome, lote_id: _lote.id, _lotesMenu: null })
      setSessao(de, _nd2, 'lote_tipo')
      await enviarMenuNumerico(de, 'Tipo de animal no *' + _lote.nome + '*?', ['Nelore','Angus','Cruzado','Girolando','Outros']); return
    }
    if (dados.lote_nome && !dados.tipo_animal) {
      var _tipos = ['Nelore','Angus','Cruzado','Girolando','Outros']
      var _it = parsearOpcao(resposta, _tipos.length)
      if (_it !== null) {
        var _nd3 = Object.assign({}, dados, { tipo_animal: _tipos[_it] })
        var _cats3 = CATEGORIAS_POR_TIPO[_nd3.tipo_guiado] || []
        setSessao(de, _nd3, 'peso_lote')
        await enviarMensagem(de,
          '✅ Ok! *' + (_nd3.lote_nome || 'Lote') + '* — *' + _tipos[_it] + '*\n\n' +
          '⚖️ Qual o *peso total* do lote em kg?\n\n' +
          '_Ex: "6.500 kg" · "450 arrobas" · ou "pular" para continuar sem peso_'
        )
        return
      }
    }
    // ── fim cascata ──
    try {
      // Extrair lote e tipo de animal do texto via GPT
      let lotesDisp = []
      let subsDisp = []
      try {
        const faz = await dbFazendas.resolverFazenda(dados.fazenda || 'Grupo Ricci')
        if (faz) {
          lotesDisp = await dbFazendas.listarLotes(faz.id)
          const sbClient = require('./supabase').supabase
          const { data: subs } = await sbClient.from('subdivisoes').select('id,nome,tipo').eq('fazenda_id', faz.id).eq('ativo', true)
          subsDisp = subs || []
        }
      } catch(e) {}
      const extraido = await extrairLoteTipo(resposta, lotesDisp, subsDisp)
      const novosDados = Object.assign({}, dados, {
        subdivisao_nome: extraido.subdivisao || dados.subdivisao_nome || null,
        lote_nome: extraido.lote || dados.lote_nome || null,
        tipo_animal: extraido.tipo_animal || dados.tipo_animal || null,
      })
      const cats = CATEGORIAS_POR_TIPO[dados.tipo_guiado] || []
      const listaCats = cats.map(function(c) { return '• ' + c }).join('\n')
      setSessao(de, novosDados, 'peso_lote')
      await enviarMensagem(de,
        '✅ Ok! *' + (novosDados.lote_nome || 'Lote') + '* — *' + (novosDados.tipo_animal || dados.tipo_animal || '') + '*\n\n' +
        '⚖️ Qual o *peso total* do lote em kg?\n\n' +
        '_Ex: "6.500 kg" · "450 arrobas" · ou "pular" para continuar sem peso_'
      )
    } catch(e) {
      await enviarMensagem(de, '_Não entendi. Informe o lote e tipo de animal, ex: "Lote Engorda, Nelore"._')
    }
    return
  }

  if (etapa === 'categorias') {
    await enviarMensagem(de, '_Processando categorias..._')
    try {
      var movs = []
      if (dados.tipo_guiado === 'mapa') {
        var extraido2 = await extrairDadosRebanho(resposta)
        movs = extraido2.categorias || []
      } else {
        movs = await extrairMovimentacaoMultipla(resposta + ' (tipo: ' + dados.label_tipo + ')')
      }
      const novosDados2 = Object.assign({}, dados, { _movimentacoesGuiadas: movs, _transcricaoCategorias: resposta })
      if (TIPOS_EXIGEM_PESO.includes(dados.tipo_interno)) {
        setSessao(de, novosDados2, 'peso_lote')
        await enviarMensagem(de,
          '⚖️ Esta movimentação exige o *peso do lote*.\n\n' +
          'Informe o peso total ou médio:\n\n' +
          '_Ex: "450 arrobas" · "6.750 kg" · "peso médio 15 arrobas por cabeça"_'
        )
      } else {
        setSessao(de, novosDados2, 'confirmacao_guiada')
        await enviarMensagem(de, gerarResumoGuiado(novosDados2))
      }
    } catch(e) {
      const cats = CATEGORIAS_POR_TIPO[dados.tipo_guiado] || []
      const ia = await tentarEntenderComIA(de, resposta, dados, 'Preciso saber: quantidades por categoria para ' + (dados.label_tipo||'') + '. Categorias: ' + cats.join(', '))
      if (ia.entendeu && ia.dados_extraidos) {
        const movs = ia.dados_extraidos.movimentacoes || ia.dados_extraidos.categorias || []
        const novosDados2 = Object.assign({}, dados, { _movimentacoesGuiadas: movs })
        setSessao(de, novosDados2, 'confirmacao_guiada')
        await enviarMensagem(de, gerarResumoGuiado(novosDados2))
      } else {
        const msgIA = ia.resposta || '_Não entendi. Fale as quantidades por categoria, ex: "3 bezerros e 2 bezerras"._'
        await enviarMensagem(de, msgIA)
      }
      return
    }
    return
  }

  if (etapa === 'peso_lote') {
    await enviarMensagem(de, '_Processando peso..._')
    const cats = CATEGORIAS_POR_TIPO[dados.tipo_guiado] || []
    const listaCats = cats.map(function(c) { return '• ' + c }).join('\n')
    const pular = ['pular','skip','sem peso','nao','não','n'].includes(respostaLower.trim())
    if (pular) {
      setSessao(de, dados, 'categorias')
      await enviarMensagem(de,
        'Agora informe as *quantidades por categoria* para *' + dados.label_tipo + '*:\n\n' +
        listaCats + '\n\n_Ex: "50 garrotes 1.3, 30 bois 1.6" ou áudio._'
      )
      return
    }
    const pesoExtraido = await extrairPeso(resposta)
    if (!pesoExtraido.peso_total_kg && !pesoExtraido.peso_medio_kg) {
      await enviarMensagem(de,
        '⚠️ Não identifiquei o peso.\n\n' +
        'Tente novamente. Ex: _"6.500 kg"_, _"450 arrobas"_ — ou responda *pular* para continuar sem peso.'
      )
      return
    }
    const novosDados3 = Object.assign({}, dados, {
      peso_total_kg: pesoExtraido.peso_total_kg,
      peso_medio_kg: pesoExtraido.peso_medio_kg,
      peso_unidade: pesoExtraido.unidade_original
    })
    setSessao(de, novosDados3, 'categorias')
    await enviarMensagem(de,
      '✅ Peso registrado: *' + (pesoExtraido.peso_total_kg || 0).toLocaleString('pt-BR') + ' kg*\n\n' +
      'Agora informe as *quantidades por categoria* para *' + dados.label_tipo + '*:\n\n' +
      listaCats + '\n\n_Ex: "52 garrotes 1.3, 10 bois 1.5" ou áudio._'
    )
    return
  }

  if (etapa === 'confirmacao_guiada') {
    if (['sim','s','yes','ok','confirmo','correto','pode salvar','salvar'].includes(respostaLower)) {
      limparSessao(de)
      await enviarMensagem(de, '_Salvando..._')
      await salvarFluxoGuiado(de, dados)
      return
    }
    if (['não','nao','n','errado','cancela','cancelar'].includes(respostaLower)) {
      limparSessao(de)
      await enviarMensagem(de, '_Ok, operação cancelada. Envie uma nova mensagem para recomeçar._')
      return
    }
    // Detectar "faça a média" ou "calcular média" — não reprocessar categorias
    if (respostaLower.includes('média') || respostaLower.includes('media') || respostaLower.includes('calcul')) {
      await enviarMensagem(de, gerarResumoGuiado(dados))
      return
    }
    // Detectar intenção de informar peso
    if (respostaLower.includes('peso') || respostaLower.includes('arroba') || respostaLower.includes('kg') || respostaLower.match(/\d+\s*(kg|@|arroba)/i)) {
      if (respostaLower.includes('informar') || respostaLower.includes('quero') || respostaLower.includes('adicionar') || respostaLower.includes('incluir')) {
        setSessao(de, dados, 'peso_lote')
        await enviarMensagem(de,
          '⚖️ Informe o *peso total* do lote:\\n\\n' +
          '_Ex: "6.500 kg" · "450 arrobas" · "peso médio 15 arrobas por cabeça"_'
        )
        return
      }
      // Tentar extrair peso direto
      const pesoDir = await extrairPeso(resposta)
      if (pesoDir && pesoDir.peso_total_kg) {
        const nd = Object.assign({}, dados, { peso_total_kg: pesoDir.peso_total_kg, peso_medio_kg: pesoDir.peso_medio_kg })
        setSessao(de, nd, 'confirmacao_guiada')
        await enviarMensagem(de, gerarResumoGuiado(nd))
        return
      }
    }
    if (resposta.length > 5) {
      await enviarMensagem(de, '_Aplicando correção..._')
      const correcao = await extrairMovimentacaoMultipla(resposta + ' (tipo: ' + dados.label_tipo + ')')
      const dadosCorrigidos = Object.assign({}, dados, { _movimentacoesGuiadas: correcao })
      setSessao(de, dadosCorrigidos, 'confirmacao_guiada')
      await enviarMensagem(de, gerarResumoGuiado(dadosCorrigidos))
      return
    }
    await enviarMensagem(de, '_Responda *sim* para salvar, *não* para cancelar, ou informe o peso do lote._')
    return
  }
}

// ─── Resumo de confirmação para o fluxo guiado ───────────────────────────────
function gerarResumoGuiado(dados) {
  const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const periodo = dados.mes ? (dados.dia ? dados.dia + '/' : '') + meses[dados.mes] + '/' + dados.ano : '—'
  const movs = dados._movimentacoesGuiadas || []
  const cats = CATEGORIAS_POR_TIPO[dados.tipo_guiado] || []

  var linhas = ''
  if (dados.tipo_guiado === 'mapa') {
    linhas = movs.filter(function(c) { return c.existencia_atual > 0 })
      .map(function(c) { return '  • ' + c.item + ' ' + c.discriminacao + ': ' + c.existencia_atual }).join('\n')
    const zeros = movs.filter(function(c) { return !c.existencia_atual || c.existencia_atual === 0 })
    if (zeros.length) linhas += '\n\n⚠️ *Sem registro (= 0):*\n' + zeros.map(function(z) { return '  • ' + z.item + ' ' + z.discriminacao }).join('\n')
  } else {
    // Lookup por código para garantir nome correto
    const catMap = {}
    TODAS_CATS.forEach(function(c) { const p = c.split(' '); catMap[p[0]] = c.substring(p[0].length+1) })
    linhas = movs.map(function(m) {
      const cod = (m.categoria || m.categoria_item || '').match(/\d+\.\d+/)
      const nomecat = cod ? (catMap[cod[0]] || m.categoria || m.categoria_item || '—') : (m.categoria || m.categoria_item || '—')
      return '  • ' + (cod ? cod[0] + ' ' + nomecat : nomecat) + ': ' + (m.quantidade || 0)
    }).join('\n') || '  (nenhuma quantidade identificada)'
    const categoriasInformadas = movs.map(function(m) { return (m.categoria || '').toLowerCase() })
    const zeros = cats.filter(function(c) {
      return !categoriasInformadas.some(function(ci) { return c.toLowerCase().includes(ci.split(' ')[0].toLowerCase()) })
    })
    if (zeros.length) linhas += '\n\n⚠️ *Não informado (= 0):*\n' + zeros.map(function(z) { return '  • ' + z }).join('\n')
  }

  const qtdTotal = movs.reduce(function(s, m) { return s + (m.quantidade || 0) }, 0)
  const pesoMedioCalc = (dados.peso_total_kg && qtdTotal > 0)
    ? Math.round(dados.peso_total_kg / qtdTotal)
    : dados.peso_medio_kg || null

  // Fator de conversão arroba: bezerros/bezerras = 30kg/@, demais = 15kg/@
  function kgParaArrobas(kg, catNome) {
    if (!kg) return null
    const ehBezerro = catNome && (catNome.toLowerCase().includes('bezerra') || catNome.toLowerCase().includes('bezerro'))
    const fator = ehBezerro ? 30 : 15
    return (kg / fator).toFixed(1)
  }

  // Determinar categoria predominante do lote para conversão do peso total
  const catPredominante = movs.length === 1 ? (movs[0].categoria || movs[0].categoria_item || '') : ''
  const arrobasTotal = dados.peso_total_kg ? kgParaArrobas(dados.peso_total_kg, catPredominante) : null
  const arrobasMedia = pesoMedioCalc ? kgParaArrobas(pesoMedioCalc, catPredominante) : null

  const pesoLine = dados.peso_total_kg
    ? '\n⚖️ *Peso total:* ' + dados.peso_total_kg.toLocaleString('pt-BR') + ' kg (' + arrobasTotal + '@)' +
      (pesoMedioCalc ? ' | *Médio:* ' + pesoMedioCalc.toLocaleString('pt-BR') + ' kg/cab (' + arrobasMedia + '@)' : '')
    : ''

  console.log('[resumo] fazenda:', dados.fazenda, '| sub:', dados.subdivisao_nome, '| lote:', dados.lote_nome, '| tipo_animal:', dados.tipo_animal)
  return '📋 *Confira antes de salvar:*\n\n' +
    '📌 *Tipo:* ' + dados.label_tipo + '\n' +
    '📍 *Local:* ' + (dados.fazenda || '—') +
      (dados.subdivisao_nome ? ' › ' + dados.subdivisao_nome : '') +
      (dados.lote_nome ? ' › ' + dados.lote_nome : '') + '\n' +
    (dados.tipo_animal ? '🐄 *Animal:* ' + dados.tipo_animal + '\n' : '') +
    '📅 *Data:* ' + periodo +
    pesoLine + '\n\n*Por categoria:*\n' + (linhas || '  —') + '\n\n' +
    'Está correto? Responda *sim* para salvar, *não* para cancelar ou informe o peso do lote.'
}

// ─── Salvar dados do fluxo guiado ────────────────────────────────────────────
async function salvarFluxoGuiado(de, dados) {
  try {
    if (dados.tipo_guiado === 'mapa') {
      const dadosMapa = Object.assign({}, dados, { categorias: dados._movimentacoesGuiadas || [] })
      await finalizarSalvamento(de, dadosMapa)
      return
    }
    const movs = dados._movimentacoesGuiadas || []
    if (movs.length === 0) {
      await enviarMensagem(de, '⚠️ Nenhuma movimentação identificada para salvar.')
      return
    }
    for (var i = 0; i < movs.length; i++) {
      const mov = movs[i]
      // Resolver categoria pelo código se vier null
      const catFinal = mov.categoria || mov.categoria_item || null
      const codMatch = catFinal ? catFinal.match(/\d+\.\d+/) : null
      const catNome = codMatch ? (TODAS_CATS.find(function(c) { return c.startsWith(codMatch[0]) }) || catFinal) : catFinal

      const movCompleto = Object.assign({}, mov, {
        tipo: dados.tipo_interno,
        fazenda: dados.fazenda || null,
        subdivisao_nome: dados.subdivisao_nome || null,
        lote_nome: dados.lote_nome || null,
        tipo_animal: dados.tipo_animal || null,
        dia: mov.dia || dados.dia,
        mes: mov.mes || dados.mes,
        ano: mov.ano || dados.ano,
        peso: dados.peso_total_kg || mov.peso || null,
        peso_total_kg: dados.peso_total_kg || null,
        peso_medio_kg: dados.peso_medio_kg || null,
        categoria: catNome || mov.categoria || null,
        categoria_item: catNome || mov.categoria_item || null,
      })
      await salvarEResponderMovimentacao(de, movCompleto)
    }
    await enviarMensagem(de,
      '✅ *' + dados.label_tipo + ' registrada com sucesso!*\n\n' +
      '_Envie uma nova mensagem para registrar outra movimentação._'
    )
    comprimirMemoriaUsuario(de).catch(function() {})
  } catch(e) {
    await enviarMensagem(de, 'Erro ao salvar: ' + e.message)
  }
}


// ─── Análise do que está faltando ─────────────────────────────────────────────
function analisarFaltando(dados) {
  const faltando = []

  if (!dados.mes || !dados.ano || !dados.dia) faltando.push('periodo')

  const temCategorias = dados.categorias && dados.categorias.length > 0
  const temExistencia = temCategorias && dados.categorias.some(c => c.existencia_atual > 0)
  const temMovimentacao = temCategorias && dados.categorias.some(c =>
    (c.entrada_nascimento||0)+(c.entrada_compra||0)+(c.saida_morte||0)+
    (c.saida_venda||0)+(c.saida_desmama||0)+(c.entrada_desmama||0) > 0
  )
  if (!temExistencia && !temMovimentacao) faltando.push('existencia')

  const temMovim = temCategorias && dados.categorias.some(c =>
    (c.entrada_nascimento || 0) + (c.saida_morte || 0) +
    (c.saida_venda || 0) + (c.entrada_compra || 0) > 0
  )
  if (temCategorias && !temMovim) faltando.push('movimentacoes')

  return faltando
}

// ─── Gerador de perguntas ─────────────────────────────────────────────────────
function gerarPergunta(etapa, dados) {
  const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

  if (etapa === 'periodo') {
    // Se dia, mes e ano já foram extraídos, pular para próxima etapa
    if (dados.dia && dados.mes && dados.ano) {
      return gerarPerguntaEtapa(dados, 'existencia')
    }
    if (dados.mes && dados.ano && !dados.dia) {
      return `_Identifiquei ${meses[dados.mes]} de ${dados.ano}, mas preciso do dia._\n\n📅 *Qual o dia deste mapa?*\nEx: *02* ou *dia 2*`
    }
    return `_Não entendi sua mensagem._ ⚠️\n\nResponda *menu* para voltar ao início e tentar novamente.`
  }

  if (etapa === 'existencia') {
    const temCats = (dados.categorias || []).filter(c => c.existencia_atual > 0)
    const temMov = (dados.categorias || []).filter(c =>
      (c.entrada_nascimento||0)+(c.entrada_compra||0)+(c.saida_morte||0)+(c.saida_venda||0) > 0
    )
    if (temMov.length > 0 && temCats.length === 0) {
      return '_Registrei as movimentações! Mas preciso do total atual._\n\n🐄 *Quantas cabeças tem ao total em cada categoria?*\nSe não souber, responda *0*.'
    }
    const jatem = temCats.length > 0 ? '\n\nJá registrei: ' + temCats.map(c => c.item + ' (' + c.existencia_atual + ')').join(', ') : ''
    return '_Não entendi sua mensagem._ ⚠️' + jatem + '\n\nResponda *menu* para voltar ao início e tentar novamente.'
  }

  if (etapa === 'movimentacoes') {
    const periodo = dados.mes ? `${meses[dados.mes]}/${dados.ano}` : 'este mês'
    const total = dados.categorias?.reduce((s, c) => s + (c.existencia_atual || 0), 0) || 0
    return `✅ *Captei ${total} cabeças em ${periodo}.*\n\n📋 *Houve movimentações neste mês?*\nNascimentos, mortes, compras ou vendas?\n\nResponda com os números ou *não* se não houver.`
  }

  return ''
}

// ─── Resumo para confirmação ──────────────────────────────────────────────────
function gerarResumoConfirmacao(dados) {
  const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

  const total = dados.categorias?.reduce((s, c) => s + (c.existencia_atual || 0), 0) || 0
  const machos = dados.categorias?.filter(c => c.sexo==='M').reduce((s,c) => s+(c.existencia_atual||0), 0) || 0
  const femeas = dados.categorias?.filter(c => c.sexo==='F').reduce((s,c) => s+(c.existencia_atual||0), 0) || 0
  const nasc  = dados.categorias?.reduce((s,c) => s+(c.entrada_nascimento||0), 0) || 0
  const mortes = dados.categorias?.reduce((s,c) => s+(c.saida_morte||0), 0) || 0
  const vendas = dados.categorias?.reduce((s,c) => s+(c.saida_venda||0), 0) || 0
  const compras = dados.categorias?.reduce((s,c) => s+(c.entrada_compra||0), 0) || 0
  const periodo = dados.mes ? `${meses[dados.mes]}/${dados.ano}` : '—'
  const lote = dados.lote_nome ? `\n*Lote:* ${dados.lote_nome}` : ''

  const linhasCat = (dados.categorias || [])
    .filter(c => c.existencia_atual > 0)
    .map(c => `  • ${c.item} ${c.discriminacao}: ${c.existencia_atual}`)
    .join('\n')

  return `📋 *Confira os dados antes de salvar:*

*Período:* ${periodo}${lote}
*Total:* ${total} cabeças (M: ${machos} | F: ${femeas})

*Por categoria:*
${linhasCat || '  (nenhuma)'}

*Movimentações:*
  Nascimentos: ${nasc} | Compras: ${compras}
  Vendas: ${vendas} | Mortes: ${mortes}

Está correto? Responda *sim* para salvar ou *não* para corrigir.`
}


// ─── Fallback IA: tenta entender mensagem quando extração falha ───────────────
async function tentarEntenderComIA(de, texto, dados, contexto) {
  try {
    const axios = require('axios')
    const prompt = `Você é um assistente de registro de rebanho bovino. 
O peão enviou a mensagem: "${texto}"
Contexto atual: ${contexto}
Dados já coletados: fazenda="${dados.fazenda||''}", tipo="${dados.label_tipo||dados.tipo_guiado||''}"

Responda em JSON com:
- entendeu: true/false
- resposta: mensagem curta e amigável para o peão (em português informal, max 2 linhas)
- dados_extraidos: objeto com os dados que conseguiu extrair (ou null)

Responda APENAS com JSON válido, sem markdown.`

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 10000
    })
    const raw = resp.data.choices[0].message.content.trim().replace(/```json|```/g, '')
    return JSON.parse(raw)
  } catch(e) {
    console.log('[WARN] tentarEntenderComIA:', e.message)
    return { entendeu: false, resposta: null, dados_extraidos: null }
  }
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
function validarTwilio(req, res, next) {
  // if (!twilio.validateRequest(...)) return res.status(403).send('Forbidden')
  next()
}

function responderWhatsApp(res, msg) {
  const twiml = new twilio.twiml.MessagingResponse()
  twiml.message(msg)
  res.type('text/xml').send(twiml.toString())
}

app.post('/webhook/whatsapp', validarTwilio, async (req, res) => {
  const { From: de, Body: corpo, NumMedia: numMedia,
    MediaUrl0: mediaUrl, MediaContentType0: mediaType } = req.body

  console.log(`Msg ${de} | mídia:${numMedia} | tipo:${mediaType}`)

  try {
    const sessao = sessoes[de]

    // ── Sessão ativa: processar resposta ──
    if (sessao) {
      const { dados, etapa } = sessao
      const temAudio = parseInt(numMedia) > 0 && mediaType?.startsWith('audio')

      if (temAudio) {
        responderWhatsApp(res, '_Ouvindo seu áudio..._')
        transcreverAudio(mediaUrl, process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
          .then(txt => {
            const _txtLog = typeof txt === 'string' ? txt : (txt?.text || txt?.transcription || JSON.stringify(txt) || ''); console.log('Áudio em sessão (' + etapa + '):', _txtLog.substring(0, 100))
            const txtStr = typeof txt === 'string' ? txt : (txt?.text || txt?.transcription || JSON.stringify(txt) || '')
            if (dados._guiado || etapa === 'menu_inicial' || etapa === 'local_data' || etapa === 'lote_tipo' ||
                etapa === 'categorias' || etapa === 'peso_lote' || etapa === 'confirmacao_guiada') {
              return processarFluxoGuiado(de, txtStr, dados, etapa)
            }
            return tratarRespostaSessao(de, txtStr, dados, etapa)
          })
          .catch(err => enviarMensagem(de, 'Erro: ' + err.message))
        return
      }

      const resposta = (corpo || '').trim().toLowerCase()


      // ── CANCELAR / MENU: funciona em qualquer etapa ──
      if (resposta === 'cancelar' || resposta === 'cancel') {
        limparSessao(de)
        return responderWhatsApp(res, '_Operação cancelada. Envie uma nova mensagem para recomeçar._')
      }
      if (resposta === 'menu') {
        limparSessao(de)
        responderWhatsApp(res, '_Abrindo menu..._')
        const usuarioMenu = await obterOuCriarUsuario(de)
        enviarMenuInicial(de, usuarioMenu).catch(err => enviarMensagem(de, 'Erro: ' + err.message))
        return
      }

      // ── FLUXO GUIADO: roteamento para etapas do novo fluxo ──
      if (dados._guiado || etapa === 'menu_inicial' || etapa === 'local_data' || etapa === 'lote_tipo' ||
          etapa === 'categorias' || etapa === 'peso_lote' || etapa === 'confirmacao_guiada') {
        if (temAudio) {
          responderWhatsApp(res, '_Ouvindo seu áudio..._')
          transcreverAudio(mediaUrl, process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
            .then(function(txt) { return processarFluxoGuiado(de, typeof txt === 'string' ? txt : (txt?.text || ''), dados, etapa) })
            .catch(function(err) { enviarMensagem(de, 'Erro: ' + err.message) })
          return
        }
        responderWhatsApp(res, '_Processando..._')
        processarFluxoGuiado(de, corpo, dados, etapa).catch(function(err) {
          enviarMensagem(de, 'Erro: ' + err.message)
        })
        return
      }


      // CONFIRMAÇÃO
      if (etapa === 'confirmacao') {
        if (resposta === 'sim' || resposta === 's' || resposta === 'yes') {
          limparSessao(de)
          responderWhatsApp(res, '_Salvando..._')
          if (dados.categorias && dados.categorias.length > 0 && dados._transcricaoOriginal) { salvarExemploConfirmado('mapa', dados._transcricaoOriginal, dados, dados.fazenda).catch(() => {}) }
          comprimirMemoriaUsuario(de).catch(() => {})
          finalizarSalvamento(de, dados).catch(err =>
            enviarMensagem(de, `Erro ao salvar: ${err.message}`))
        } else if (resposta === 'não' || resposta === 'nao' || resposta === 'n') {
          limparSessao(de)
          responderWhatsApp(res, '_Ok! Envie um novo áudio com os dados corrigidos._')
        } else {
          responderWhatsApp(res, `_Responda *sim* para salvar ou *não* para corrigir._`)
        }
        return
      }

      // MOVIMENTAÇÕES: aceitar "não" ou processar resposta
      if (etapa === 'movimentacoes') {
        dados._movPerguntada = true
        if (resposta === 'não' || resposta === 'nao' || resposta === 'n' || resposta === 'nenhuma') {
          // Sem movimentações — ir para confirmação
          setSessao(de, dados, 'confirmacao')
          responderWhatsApp(res, gerarResumoConfirmacao(dados))
        } else {
          // Tentar extrair movimentações do texto/áudio
          responderWhatsApp(res, '_Processando movimentações..._')
          processarComplemento(de, corpo, dados, 'movimentacoes').catch(err =>
            enviarMensagem(de, `Erro: ${err.message}`))
        }
        return
      }

      // CADASTRO: resposta de texto para campos de onboarding
      if (etapa.startsWith('cadastro_') || etapa === 'movimentacao_campo') {
        responderWhatsApp(res, '_Processando..._')
        tratarRespostaSessao(de, corpo, dados, etapa).catch(err =>
          enviarMensagem(de, 'Erro: ' + err.message))
        return
      }

      // PERÍODO, EXISTÊNCIA, LOTE: sempre tentar extrair do texto
      responderWhatsApp(res, '_Processando..._')
      processarComplemento(de, corpo, dados, etapa).catch(err =>
        enviarMensagem(de, `Erro: ${err.message}`))
      return
    }

    // ── Áudio novo ──
    if (parseInt(numMedia) > 0 && mediaType?.startsWith('audio')) {
      saudarSeNecessario(de).catch(() => {})
      const logId = await criarLog(de, 'audio', { mediaUrl })
      responderWhatsApp(res, '_Recebi seu áudio! Transcrevendo e processando..._')
      processarAudio(de, mediaUrl, logId).catch(err => {
        console.log('[ERRO] Audio:', err.message, '| status:', err.response?.status, '| detail:', JSON.stringify(err.response?.data||{}).substring(0,80))
        enviarMensagem(de, `Erro: ${err.message}. Tente novamente.`)
      })
      return
    }

    // ── Texto longo novo ──
    if (corpo && corpo.trim().length > 20) {
      const logIdTxt = await criarLog(de, 'texto', { texto: corpo })
      responderWhatsApp(res, '_Processando..._')
      processarTexto(de, corpo, logIdTxt).catch(err =>
        enviarMensagem(de, `Erro: ${err.message}`))
      return
    }

    // ── Consulta RAG: perguntas sobre o rebanho ──
    const ac = getAgenteConsulta()
    if (ac.ehPergunta(corpo)) {
      const usuarioRAG = await obterOuCriarUsuario(de)
      const fazendaRAG = usuarioRAG?.fazenda || 'Grupo Ricci'
      responderWhatsApp(res, '_Consultando dados do rebanho..._')
      ac.responderPergunta(corpo, fazendaRAG, usuarioRAG?.nome)
        .then(async resposta => {
          if (resposta) {
            await enviarMensagem(de, resposta)
          } else {
            await enviarMensagem(de, '_Não encontrei informações suficientes. Tente reformular a pergunta._')
          }
        })
        .catch(err => enviarMensagem(de, 'Erro: ' + err.message))
      return
    }

    // ── Saudação: iniciar fluxo guiado ──
    if (eSaudacao(corpo)) {
      const usuarioSauda = await obterOuCriarUsuario(de)
      if (!usuarioSauda.nome) {
        responderWhatsApp(res,
          '*Olá! Sou o assistente de rebanho do Grupo Ricci.* 🐄\n\nVou te conhecer melhor em algumas perguntas rápidas — mas você já pode enviar áudios com dados do rebanho a qualquer momento!')
        perguntarProximoCadastro(de)
        return
      }
      responderWhatsApp(res, '_Abrindo menu..._')
      enviarMenuInicial(de, usuarioSauda).catch(function(err) {
        enviarMensagem(de, 'Erro: ' + err.message)
      })
      return
    }


    // ── Comandos ──
    const correcao = detectarCorrecao(corpo)
    if (correcao && ultimaClassificacao[de]) {
      const ult = ultimaClassificacao[de]
      if (ult.intencao !== correcao.intencao) {
        registrarFeedback(de, ult.transcricao, ult.intencao, correcao.intencao).catch(() => {})
        delete ultimaClassificacao[de]
        return responderWhatsApp(res, '_Entendido! Aprendi com essa correção._ ✅')
      }
    }

    const cmd = (corpo || '').trim().toLowerCase()
    if (cmd === 'resumo') {
      const r = await buscarResumoMensal(3)
      return responderWhatsApp(res, formatarResumoRapido(r))
    }
    if (cmd === 'lotes') {
      const l = await buscarResumoPorLote()
      return responderWhatsApp(res, formatarLotes(l))
    }
    if (cmd === 'cancelar' || cmd === 'cancel') {
      limparSessao(de)
      return responderWhatsApp(res, '_Operação cancelada._')
    }

    // Verificar cadastro do usuário
    const usuario = await obterOuCriarUsuario(de)
    const ehNovo = !usuario.nome

    if (ehNovo) {
      responderWhatsApp(res,
        `*Olá! Sou o assistente de rebanho do Grupo Ricci.* 🐄\n\nVou te conhecer melhor em algumas perguntas rápidas — mas você já pode enviar áudios com dados do rebanho a qualquer momento!`)
      perguntarProximoCadastro(de)
      return
    }

    responderWhatsApp(res,
    `*Olá${usuario.nome ? ', ' + usuario.nome.split(' ')[0] : ''}! Sou o assistente de rebanho do Grupo Ricci.* 🐄\n\nEnvie um *áudio* com os dados do mapa de rebanho.\n\nComandos:\n- *resumo* — últimos 3 meses\n- *lotes* — resumo por lote\n- *cancelar* — cancela operação em andamento`)
  } catch (err) {
    console.error('Erro webhook:', err.message)
    console.error('Stack:', err.stack?.split('\n').slice(0,3).join(' | '))
    responderWhatsApp(res, 'Erro inesperado. Tente novamente.')
  }
})

// ─── Usuários e onboarding progressivo ────────────────────────────────────────
const CAMPOS_CADASTRO = [
  { campo: 'nome',        pergunta: '👋 Antes de continuar, como é seu *nome*?' },
  { campo: 'funcao',      pergunta: '💼 Qual sua *função* na fazenda? (peão, gerente, veterinário...)' },
  { campo: 'fazenda',     pergunta: '🏡 Em qual *fazenda ou unidade* você trabalha?' },
  { campo: 'lotes_cuida', pergunta: '🐄 Quais *lotes ou pastos* você cuida? (pode listar vários)' },
]

async function obterOuCriarUsuario(whatsapp) {
  const { data } = await supabase.from('usuarios').select('*').eq('whatsapp', whatsapp).single()
  if (data) return data
  const { data: novo } = await supabase.from('usuarios')
    .insert({ whatsapp }).select('*').single()
  return novo || { whatsapp }
}

async function salvarCampoUsuario(whatsapp, campo, valor) {
  await supabase.from('usuarios')
    .update({ [campo]: valor, atualizado_em: new Date() })
    .eq('whatsapp', whatsapp)
}

async function incrementarEnvios(whatsapp) {
  const { data } = await supabase.from('usuarios').select('total_envios').eq('whatsapp', whatsapp).single()
  await supabase.from('usuarios')
    .update({ total_envios: ((data?.total_envios) || 0) + 1 })
    .eq('whatsapp', whatsapp)
}

function proximoCampoCadastro(usuario) {
  for (const c of CAMPOS_CADASTRO) {
    if (!usuario[c.campo]) return c
  }
  return null
}

async function perguntarProximoCadastro(de) {
  const usuario = await obterOuCriarUsuario(de)
  const proximo = proximoCampoCadastro(usuario)
  if (!proximo) return false
  setSessao(de, { _cadastro: true }, 'cadastro_' + proximo.campo)
  await enviarMensagem(de, proximo.pergunta)
  return true
}

// ─── Tratar resposta dentro de sessão (texto ou áudio transcrito) ────────────
async function tratarRespostaSessao(de, textoResposta, dados, etapa) {
  const resposta = (textoResposta || '').trim().toLowerCase()

  // Aprendizado ativo
  if (etapa === 'confirmar_intencao') {
    var txOrig = dados.texto, lidOrig = dados.logId, intOrig = dados.intencao
    var respLower = textoResposta.toLowerCase().trim()
    limparSessao(de)
    if (respLower === 'sim' || respLower === 's') {
      registrarFeedback(de, txOrig, intOrig, intOrig).catch(() => {})
      if (dados.dadosPre) {
        if (intOrig === 'movimentacao') {
          var movsPre = Array.isArray(dados.dadosPre) ? dados.dadosPre : [dados.dadosPre]
          for (var mvp of movsPre) await processarMovimentacao(de, mvp, txOrig)
        } else if (intOrig === 'mapa') {
          // Determinar etapa correta com base nos dados pré-extraídos
          var etapaInicial = (dados.dadosPre.dia && dados.dadosPre.mes && dados.dadosPre.ano) ? 'existencia' : 'periodo'
          setSessao(de, dados.dadosPre, etapaInicial)
          await processarComplemento(de, txOrig, dados.dadosPre, etapaInicial)
        } else { await processarTexto(de, txOrig, lidOrig) }
      } else { await processarTexto(de, txOrig, lidOrig) }
    } else {
      var intCorr = intOrig
      if (respLower.includes('mapa') || respLower.includes('fechamento')) intCorr = 'mapa'
      else if (respLower.includes('movim') || respLower.includes('compra') || respLower.includes('venda') || respLower.includes('morte') || respLower.includes('nasc')) intCorr = 'movimentacao'
      else if (respLower.includes('consul')) intCorr = 'consulta'
      registrarFeedback(de, txOrig, intOrig, intCorr).catch(() => {})
      atualizarLog(lidOrig, { intencao_detectada: intCorr }).catch(() => {})
      if (intCorr === 'movimentacao') { var movs2 = await extrairMovimentacaoMultipla(txOrig); for (var mv of movs2) await processarMovimentacao(de, mv, txOrig) }
      else if (intCorr === 'consulta') { var dr2 = await buscarResumoMensal(6); var ctx3 = await obterMemoriaUsuario(de); await enviarMensagem(de, await agentConsulta(txOrig, dr2, ctx3)) }
      else await processarTexto(de, txOrig, lidOrig)
      await enviarMensagem(de, '_Aprendi com essa correção!_ ✅')
    }
    return
  }

  // Etapa de movimentação com campos faltando
  if (etapa === 'movimentacao_campo') {
    const movDados = dados.mov || {}
    const falt = dados.faltando || []
    const PERGS = {
      tipo: '📋 *Qual o tipo?* (morte, compra, venda, transferência, nascimento)',
      quantidade: '🔢 *Quantos animais?*',
      categoria: '🐄 *Qual a categoria?* (boi, vaca, novilho, bezerra...)',
      data: '📅 *Qual a data?* (dia/mês/ano)'
    }
    const campoAtual = falt[0]
    if (campoAtual === 'quantidade') movDados.quantidade = parseInt(textoResposta) || 0
    else movDados[campoAtual] = textoResposta.trim()
    const faltRest = falt.slice(1)
    if (faltRest.length > 0) {
      setSessao(de, { _movimentacao: true, mov: movDados, faltando: faltRest }, 'movimentacao_campo')
      await enviarMensagem(de, PERGS[faltRest[0]] || 'Informe: ' + faltRest[0])
    } else {
      limparSessao(de)
      await salvarEResponderMovimentacao(de, movDados)
    }
    return
  }

  // Etapas de cadastro progressivo
  if (etapa.startsWith('cadastro_')) {
    const campo = etapa.replace('cadastro_', '')
    let valor = (textoResposta || '').trim()
    limparSessao(de)
    // Para campo nome: extrair apenas o primeiro nome/sobrenome, ignorar transcrições longas
    if (campo === 'nome') {
      // Se muito longo, tentar extrair apenas o nome do início
      if (valor.length > 40) {
        const match = valor.match(/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,3})/i)
        valor = match ? match[1] : valor.substring(0, 30)
      }
      // Remover pontuação e caracteres estranhos
      valor = valor.replace(/[.,!?;:]/g, '').trim()
    }
    if (valor.length > 1) {
      await salvarCampoUsuario(de, campo, valor)
      const labels = { nome: 'Nome', funcao: 'Função', fazenda: 'Fazenda', lotes_cuida: 'Lotes' }
      await enviarMensagem(de, `✅ ${labels[campo] || campo} registrado: *${valor}*\n\n_Pode enviar seus áudios normalmente!_`)
    }
    return
  }

  if (etapa === 'confirmacao') {
    if (['sim','s','yes','ok','confirmo','correto','pode salvar','salvar'].includes(resposta)) {
      limparSessao(de)
      await finalizarSalvamento(de, dados)
      return
    }
    if (['não','nao','n','errado','cancela','cancelar'].includes(resposta)) {
      limparSessao(de)
      await enviarMensagem(de, '_Ok! Envie um novo áudio com os dados corrigidos._')
      return
    }
    // Resposta longa = correção! Extrair e mesclar
    if (resposta.length > 10) {
      await enviarMensagem(de, '_Aplicando correção..._')
      const complemento = await extrairComplemento(textoResposta, dados, 'movimentacoes')
      const dadosCorrigidos = mesclarDados(dados, complemento)
      setSessao(de, dadosCorrigidos, 'confirmacao')
      await enviarMensagem(de, gerarResumoConfirmacao(dadosCorrigidos))
      return
    }
    await enviarMensagem(de, '_Responda *sim* para salvar, *não* para cancelar, ou fale a correção (ex: "morreram três")._')
    return
  }

  if (etapa === 'movimentacoes') {
    dados._movPerguntada = true
    if (['não','nao','n','nenhuma','nenhum'].includes(resposta)) {
      setSessao(de, dados, 'confirmacao')
      await enviarMensagem(de, gerarResumoConfirmacao(dados))
      return
    }
    await processarComplemento(de, textoResposta, dados, 'movimentacoes')
    return
  }

  await processarComplemento(de, textoResposta, dados, etapa)
}

// ─── Processamento principal ──────────────────────────────────────────────────
async function processarAudio(de, mediaUrl, logId) {
  const textoRaw = await transcreverAudio(mediaUrl,
    process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  const texto = toStr(textoRaw)
  console.log('Transcrição:', texto.substring(0, 150))
  await processarTexto(de, texto)
}

async function processarTexto(de, texto, logId) {
  // Detectar se é movimentação pontual ou mapa mensal
  const sessaoAtiva2 = sessoes[de]
  const jaTemSessao = sessaoAtiva2 && sessaoAtiva2.dados && !sessaoAtiva2.dados._cadastro

  if (!jaTemSessao) {
    const ctx = await obterMemoriaUsuario(de)
    const exemplos = await buscarExemplosFewShot(6)
    const rota = await agentRoteador(texto, ctx, exemplos)
    ultimaClassificacao[de] = { intencao: rota.intencao, transcricao: texto }
    atualizarLog(logId, { intencao_detectada: rota.intencao, confianca: rota.confianca, status: 'processando', modelo_usado: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001' }).catch(() => {})

    // APRENDIZADO ATIVO — limiar dinâmico da tabela configuracoes
    var confiancaRota = rota.confianca || 1
    var limiarConfianca = parseFloat(process.env.CFG_LIMIAR_CONFIANCA || '0.7')
    if (confiancaRota < limiarConfianca) {
      var LABELS = { mapa:'fechamento mensal', movimentacao:'movimentação pontual', consulta:'consulta', cadastro:'cadastro' }
      // Pré-extrair para não reextrair após confirmação
      var dadosPre = null
      try {
        if (rota.intencao === 'mapa') { dadosPre = await extrairDadosRebanho(texto); dadosPre._transcricaoOriginal = texto }
        else if (rota.intencao === 'movimentacao') { dadosPre = await extrairMovimentacaoMultipla(texto) }
      } catch(e) { console.log('[WARN] Pré-extração:', e.message) }
      setSessao(de, { _pendente: true, texto: texto, logId: logId, intencao: rota.intencao, dadosPre: dadosPre }, 'confirmar_intencao')
      await enviarMensagem(de, '_Identifiquei como *' + (LABELS[rota.intencao]||rota.intencao) + '* (' + Math.round(confiancaRota*100) + '% de certeza)._\n\n✅ *sim* — confirmar\n❌ *não* — corrija: mapa, movimentação ou consulta')
      return
    }

    if (rota.intencao === 'movimentacao') {
      console.log('Roteador → MOVIMENTAÇÃO')
      const movs = await extrairMovimentacaoMultipla(texto)
      for (const mov of movs) { await processarMovimentacao(de, mov, texto) }
      return
    }
    if (rota.intencao === 'consulta') {
      const dr = await buscarResumoMensal(6)
      await enviarMensagem(de, await agentConsulta(texto, dr))
      return
    }
    console.log('Roteador → MAPA')
  }

  const dados = await extrairDadosRebanho(texto)
  dados._transcricaoOriginal = texto

  // Se há sessão ativa com dados do mesmo período, mesclar em vez de descartar
  const sessaoAtiva = sessaoAtiva2
  if (sessaoAtiva && sessaoAtiva.dados && !sessaoAtiva.dados._cadastro) {
    const dadosBase = sessaoAtiva.dados
    const mesmoMes = (!dados.mes && !dados.ano) ||
                     (!dadosBase.mes && !dadosBase.ano) ||
                     (dados.mes === dadosBase.mes && dados.ano === dadosBase.ano)
    if (mesmoMes) {
      console.log("Mesclando novo áudio com sessão existente (" + sessaoAtiva.etapa + ")")
      const dadosMerge = mesclarDados(dadosBase, dados)
      dadosMerge._movPerguntada = dadosBase._movPerguntada
      await avancarFluxo(de, dadosMerge)
      return
    }
  }

  await avancarFluxo(de, dados)
}

// ─── Processar complemento (resposta a uma pergunta) ─────────────────────────
async function processarComplemento(de, resposta, dadosAtuais, etapa) {
  const complemento = await extrairComplemento(resposta, dadosAtuais, etapa)
  const dadosMerge = mesclarDados(dadosAtuais, complemento)
  // Preservar flags de controle de fluxo
  dadosMerge._movPerguntada = dadosAtuais._movPerguntada
  dadosMerge._existPerguntada = dadosAtuais._existPerguntada
  await avancarFluxo(de, dadosMerge)
}

// ─── Avançar no fluxo verificando o que falta ────────────────────────────────
async function avancarFluxo(de, dados) {
  const faltando = analisarFaltando(dados)

  // Verificar período (sempre obrigatório)
  if (faltando.includes('periodo')) {
    setSessao(de, dados, 'periodo')
    await enviarMensagem(de, gerarPergunta('periodo', dados))
    return
  }

  // Verificar existência — apenas uma vez (flag _existPerguntada)
  if (faltando.includes('existencia') && !dados._existPerguntada) {
    dados._existPerguntada = true
    setSessao(de, dados, 'existencia')
    await enviarMensagem(de, gerarPergunta('existencia', dados))
    return
  }

  // Verificar movimentações (opcional mas importante)
  if (faltando.includes('movimentacoes') && !dados._movPerguntada) {
    setSessao(de, dados, 'movimentacoes')
    await enviarMensagem(de, gerarPergunta('movimentacoes', dados))
    return
  }

  // Tudo ok — ir para confirmação
  setSessao(de, dados, 'confirmacao')
  await enviarMensagem(de, gerarResumoConfirmacao(dados))
}

// ─── Mesclar dados extraídos ──────────────────────────────────────────────────
function mesclarDados(base, complemento) {
  const merged = { ...base }

  merged.mes = complemento.mes || base.mes || null
  merged.ano = complemento.ano || base.ano || null
  merged.dia = complemento.dia || base.dia || null
  if (complemento.lote_nome) merged.lote_nome = complemento.lote_nome
  if (complemento.lote_pasto) merged.lote_pasto = complemento.lote_pasto
  if (complemento.fazenda && complemento.fazenda !== 'Grupo Ricci') merged.fazenda = complemento.fazenda

  // Mesclar categorias
  const catMap = {}
  ;(base.categorias || []).forEach(c => { catMap[c.item] = { ...c } })

  ;(complemento.categorias || []).forEach(c => {
    if (catMap[c.item]) {
      // Atualizar campos que vieram zerados
      const campos = ['existencia_atual','existencia_anterior','entrada_nascimento',
        'entrada_compra','saida_morte','saida_venda','saida_desmama',
        'entrada_desmama','entrada_transferencia','saida_transferencia']
      campos.forEach(f => {
        if ((catMap[c.item][f] || 0) === 0 && (c[f] || 0) > 0) {
          catMap[c.item][f] = c[f]
        }
      })
    } else {
      catMap[c.item] = { ...c }
    }
  })

  merged.categorias = Object.values(catMap)

  // Recalcular totais
  merged.categorias = merged.categorias.map(cat => {
    const et = (cat.entrada_compra||0)+(cat.entrada_mudanca_cat||0)+
               (cat.entrada_desmama||0)+(cat.entrada_nascimento||0)+(cat.entrada_transferencia||0)
    const st = (cat.saida_abate||0)+(cat.saida_venda||0)+(cat.saida_morte||0)+
               (cat.saida_desmama||0)+(cat.saida_mudanca_cat||0)+(cat.saida_transferencia||0)
    const ea = Math.max(0, cat.existencia_atual || (cat.existencia_anterior||0)+et-st)
    return { ...cat, entrada_total: et, saida_total: st, existencia_atual: ea,
             indice_mortalidade: ea > 0 ? (cat.saida_morte||0)/ea : 0 }
  })

  return merged
}



// ════════════════════════════════════════════════════════════════════════════════
// MEMÓRIA DE CONTEXTO
// ════════════════════════════════════════════════════════════════════════════════

async function obterContextoUsuario(whatsapp) {
  try {
    const usuario = await obterOuCriarUsuario(whatsapp)
    const historico = JSON.parse(usuario.contexto_json || '[]')
    return {
      nome: usuario.nome, funcao: usuario.funcao,
      fazenda: usuario.fazenda, lotes: usuario.lotes_cuida,
      historico: historico.slice(0,3),
      ultimaFazenda: historico[0]?.fazenda || usuario.fazenda || 'Grupo Ricci',
    }
  } catch(e) { return { fazenda: 'Grupo Ricci', historico: [] } }
}

async function atualizarContextoUsuario(whatsapp, dados) {
  try {
    const usuario = await obterOuCriarUsuario(whatsapp)
    const historico = JSON.parse(usuario.contexto_json || '[]')
    historico.unshift({ ts: new Date().toISOString(), tipo: dados._tipoRegistro || 'mapa', fazenda: dados.fazenda, mes: dados.mes, ano: dados.ano })
    const updates = {
      ultima_atividade: new Date().toISOString(),
      total_envios: (usuario.total_envios || 0) + 1,
      contexto_json: JSON.stringify(historico.slice(0,10)),
    }
    if (dados.fazenda && dados.fazenda !== 'Grupo Ricci') updates.fazenda = dados.fazenda
    await supabase.from('usuarios').update(updates).eq('whatsapp', whatsapp)
  } catch(e) { console.log('[WARN] contexto:', e.message) }
}



// ════════════════════════════════════════════════════════════════════════════════
// FEEDBACK LOOP
// ════════════════════════════════════════════════════════════════════════════════

const ultimaClassificacao = {}

async function registrarFeedback(whatsapp, transcricao, intencaoBot, intencaoCorreta) {
  try {
    await supabase.from('bot_feedback').insert({ whatsapp, transcricao, intencao_bot: intencaoBot, intencao_correta: intencaoCorreta })
    const { data: novoEx } = await supabase.from('bot_exemplos').insert({ transcricao, intencao: intencaoCorreta, fonte: 'feedback' }).select('id').single()
    console.log('Feedback:', intencaoBot, '->', intencaoCorreta)
    // Gerar embedding RAG para o novo exemplo
    if (novoEx?.id) getRag().salvarEmbedding('bot_exemplos', novoEx.id, transcricao).catch(() => {})
  } catch(e) { console.log('[WARN] feedback:', e.message) }
}

async function buscarExemplosFewShot(limite) {
  try {
    const { data } = await supabase.from('bot_exemplos').select('transcricao, intencao').eq('ativo', true).order('criado_em', { ascending: false }).limit(limite || 6)
    return data || []
  } catch(e) { return [] }
}

function detectarCorrecao(texto) {
  const lower = (texto || '').toLowerCase().trim()
  if (/era.*(movimenta|mapa|consulta)/i.test(lower) || /isso.*[eé].*(movimenta|mapa|consulta)/i.test(lower)) {
    const m = lower.match(/(movimenta[cç][aã]o|mapa|consulta|compra|venda|morte|nascimento)/)
    if (m) {
      const p = m[1]
      if (p === 'mapa') return { intencao: 'mapa' }
      if (p === 'consulta') return { intencao: 'consulta' }
      return { intencao: 'movimentacao' }
    }
  }
  return null
}


// ════════════════════════════════════════════════════════════════════════════════
// MEMÓRIA LONGA COM COMPRESSÃO
// ════════════════════════════════════════════════════════════════════════════════

async function comprimirMemoriaUsuario(whatsapp) {
  try {
    const usuario = await obterOuCriarUsuario(whatsapp)
    const historico = JSON.parse(usuario.contexto_json || '[]')
    if (historico.length < 5) return usuario.memoria_comprimida || null
    const axios = require('axios')
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini', max_tokens: 200,
      messages: [
        { role: 'system', content: 'Crie um resumo compacto (máximo 150 palavras) do perfil deste usuário de sistema de gestão de rebanho bovino. Seja direto e factual.' },
        { role: 'user', content: 'Nome: ' + (usuario.nome||'?') + '\nFunção: ' + (usuario.funcao||'?') + '\nFazenda: ' + (usuario.fazenda||'Grupo Ricci') + '\nLotes: ' + (usuario.lotes_cuida||'?') + '\nTotal envios: ' + (usuario.total_envios||0) + '\nHistórico: ' + JSON.stringify(historico.slice(0,8)) }
      ]
    }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 })
    const memoria = resp.data.choices[0].message.content.trim()
    await supabase.from('usuarios').update({ memoria_comprimida: memoria, memoria_atualizada_em: new Date().toISOString() }).eq('whatsapp', whatsapp)
    console.log('Memória comprimida:', whatsapp, memoria.length + ' chars')
    return memoria
  } catch(e) { console.log('[WARN] memória:', e.message); return null }
}

async function obterMemoriaUsuario(whatsapp) {
  try {
    const usuario = await obterOuCriarUsuario(whatsapp)
    const historico = JSON.parse(usuario.contexto_json || '[]')
    const agora = new Date()
    const ultimaAtt = usuario.memoria_atualizada_em ? new Date(usuario.memoria_atualizada_em) : null
    const horas = ultimaAtt ? (agora - ultimaAtt) / 3600000 : 999
    if (historico.length >= 5 && horas > 24) comprimirMemoriaUsuario(whatsapp).catch(() => {})
    return {
      nome: usuario.nome, funcao: usuario.funcao,
      fazenda: usuario.fazenda, lotes: usuario.lotes_cuida,
      resumo: usuario.memoria_comprimida || null,
      historico: historico.slice(0, 3),
      ultimaFazenda: historico[0]?.fazenda || usuario.fazenda || 'Grupo Ricci',
    }
  } catch(e) { return { fazenda: 'Grupo Ricci', historico: [] } }
}

// ─── Saudação personalizada ────────────────────────────────────────────────────
const ultimaSaudacao = {} // cache em memória: { whatsapp: Date }

async function saudarSeNecessario(de) {
  try {
    const agora = new Date()
    const ultima = ultimaSaudacao[de]

    // Só saudar uma vez a cada 6 horas
    if (ultima && (agora - ultima) < 6 * 60 * 60 * 1000) return

    ultimaSaudacao[de] = agora

    const ctx = await obterContextoUsuario(de)
    if (!ctx.nome) return // sem nome cadastrado, não saudar

    const hora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })
    const h = parseInt(hora)
    const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'

    let msg = '*' + periodo + ', ' + ctx.nome.split(' ')[0] + '!* 👋'

    if (ctx.historico && ctx.historico.length > 0) {
      const ult = ctx.historico[0]
      const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      if (ult.tipo === 'mapa' && ult.mes && ult.ano) {
        msg += '\nÚltimo registro: mapa de ' + meses[ult.mes] + '/' + ult.ano
      } else if (ult.tipo === 'movimentacao') {
        msg += '\nÚltimo registro: movimentação em ' + (ult.fazenda || ctx.fazenda || 'Grupo Ricci')
      }
    }

    msg += '\n\n_Pode enviar o áudio quando quiser._'
    await enviarMensagem(de, msg)
  } catch(e) {
    console.log('[WARN] saudação:', e.message)
  }
}


// ═══════════════════════════════════════════════════════════════
// LOG DE MENSAGENS
// ═══════════════════════════════════════════════════════════════

async function criarLog(whatsapp, tipo, dados) {
  try {
    const { data } = await supabase.from('bot_logs').insert({ whatsapp, tipo, texto_original: dados.texto||null, media_url: dados.mediaUrl||null, status: 'recebido', recebido_em: new Date().toISOString() }).select('id').single()
    return data?.id || null
  } catch(e) { return null }
}

async function atualizarLog(logId, updates) {
  if (!logId) return
  try { await supabase.from('bot_logs').update({ ...updates, processado_em: new Date().toISOString() }).eq('id', logId) } catch(e) {}
}

// ─── Processar movimentação pontual ──────────────────────────────────────────
async function processarMovimentacao(de, mov, textoOriginal) {
  const faltando = []
  if (!mov.tipo) faltando.push('tipo')
  if (!mov.quantidade || mov.quantidade === 0) faltando.push('quantidade')
  if (!mov.categoria) faltando.push('categoria')
  if (!mov.data_mov && !mov.mes) faltando.push('data')

  if (faltando.length > 0) {
    const PERGUNTAS = {
      tipo:       '📋 *Qual o tipo de movimentação?*\nEx: morte, compra, venda, transferência, nascimento',
      quantidade: '🔢 *Quantos animais foram movimentados?*',
      categoria:  '🐄 *Qual a categoria dos animais?*\nEx: boi, vaca, novilho, bezerra...',
      data:       '📅 *Qual a data da movimentação?* (dia/mês/ano)',
    }
    setSessao(de, { _movimentacao: true, mov, faltando }, 'movimentacao_campo')
    await enviarMensagem(de, '_Registrei a movimentação! Alguns dados ficaram faltando._\n\n' + PERGUNTAS[faltando[0]])
    return
  }
  await salvarEResponderMovimentacao(de, mov)
}

async function salvarEResponderMovimentacao(de, mov) {
  try {
    const tipoMap = {
      entrada_compra: 'entrada_compra', saida_venda: 'saida_venda',
      transferencia: 'entrada_transferencia', saida_morte: 'saida_morte',
      entrada_nascimento: 'entrada_nascimento', entrada_desmama: 'entrada_desmama',
      saida_desmama: 'saida_desmama', pesagem: 'pesagem',
    }
    const tipo = tipoMap[mov.tipo] || mov.tipo || 'entrada_compra'
    let dataIso = null
    if (mov.dia && mov.mes && mov.ano) {
      dataIso = mov.ano + '-' + String(mov.mes).padStart(2,'0') + '-' + String(mov.dia).padStart(2,'0')
    }
    // Resolver IDs das novas tabelas
    const ctx = await dbFazendas.resolverContexto(
      mov.fazenda || null,
      mov.subdivisao_nome || null,
      mov.lote_nome || null,
      mov.tipo_animal || null
    ).catch(() => ({}))

    await supabase.from('movimentacoes_lote').insert({
      fazenda:          mov.fazenda || 'Grupo Ricci',
      fazenda_id:       ctx.fazenda_id || null,
      subdivisao_id:    ctx.subdivisao_id || null,
      lote_id:          ctx.lote_id || null,
      tipo_animal_id:   ctx.tipo_id || null,
      tipo,
      data_mov:       dataIso || new Date().toISOString().substring(0, 10),
      quantidade:     mov.quantidade || 1,
      peso:           mov.peso || null,
      peso_total_kg:  mov.peso_total_kg || null,
      peso_medio_kg:  mov.peso_medio_kg || null,
      valor:          mov.valor || null,
      categoria:      mov.categoria || null,
      categoria_item: mov.categoria_item || null,
      sexo:           mov.sexo || null,
      responsavel:    mov.responsavel || null,
      ocorrencia:     mov.ocorrencia || null,
      motivo:         mov.motivo || null,
      lote_origem:    mov.origem || null,
      lote_destino:   mov.destino || null,
      observacoes:    [mov.brincos && 'Brincos: '+mov.brincos].filter(Boolean).join(' | ') || null,
      whatsapp_de: de,
    })

    const tipoLabel = {
      entrada_compra: 'Compra', saida_venda: 'Venda',
      transferencia: 'Transferência', saida_morte: 'Morte',
      entrada_nascimento: 'Nascimento', entrada_desmama: 'Desmama', pesagem: 'Pesagem',
    }[mov.tipo] || mov.tipo || '—'

    const dataStr = mov.dia ? mov.dia + '/' + mov.mes + '/' + mov.ano : 'hoje'

    await enviarMensagem(de,
      '*Movimentação registrada!* ✅\n\n' +
      '*Tipo:* '       + tipoLabel + '\n' +
      '*Data:* '       + dataStr   + '\n' +
      '*Quantidade:* ' + (mov.quantidade || '?') + ' cabeças\n' +
      '*Categoria:* '  + (mov.categoria  || '?') + '\n' +
      (mov.origem      ? '*Origem:* '      + mov.origem      + '\n' : '') +
      (mov.destino     ? '*Destino:* '     + mov.destino     + '\n' : '') +
      (mov.responsavel ? '*Responsável:* ' + mov.responsavel + '\n' : '') +
      (mov.ocorrencia  ? '\n⚠️ *Ocorrência:* ' + mov.ocorrencia : '')
    )
  } catch(err) {
    console.error('Erro ao salvar movimentação:', err.message)
    await enviarMensagem(de, 'Erro ao salvar movimentação: ' + err.message)
  }
}

// ─── Salvar após confirmação ──────────────────────────────────────────────────
async function finalizarSalvamento(de, dados) {
  const salvo = await salvarRebanho(dados, '', de)
  const resumo = gerarResumoWhatsApp(dados)
  await enviarMensagem(de, resumo)
  console.log(`Salvo: ${salvo.mes}/${salvo.ano} | ${salvo.totalCategorias} cats`)
  getAgenteConsulta().gerarSnapshot(dados.fazenda || 'Grupo Ricci').catch(() => {})
  incrementarEnvios(de).catch(() => {})
  // Onboarding progressivo: perguntar um campo pendente após cada envio
  setTimeout(() => { perguntarProximoCadastro(de).catch(() => {}) }, 2000)
}

async function enviarMensagem(para, mensagem) {
  try {
    return await getTwilioClient().messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: para,
      body: mensagem,
    })
  } catch (err) {
    console.log('[ERRO] Twilio:', err.message, '| status:', err.response?.status, '| detail:', JSON.stringify(err.response?.data||{}).substring(0,80))
    return null
  }
}

// ─── Enviar lista interativa via Twilio Content API ───────────────────────────
// items: [{ id, title, description? }]
async function enviarLista(para, body, buttonLabel, items, sections) {
  try {
    const axios = require('axios')
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken  = process.env.TWILIO_AUTH_TOKEN
    const from       = process.env.TWILIO_WHATSAPP_NUMBER.replace('whatsapp:', '')

    // Criar content template dinamicamente
    const sectionList = sections || [{ title: 'Opções', items: items.map(i => ({ id: i.id, item: i.title, description: i.description || '' })) }]

    const contentResp = await axios.post(
      `https://content.twilio.com/v1/Content`,
      {
        friendly_name: `list_${Date.now()}`,
        language: 'pt-BR',
        variables: {},
        types: {
          'twilio/list-picker': {
            body,
            button: buttonLabel || 'Selecionar',
            items: sectionList
          }
        }
      },
      { auth: { username: accountSid, password: authToken } }
    )

    const contentSid = contentResp.data.sid
    const toNumber = para.replace('whatsapp:', '')

    const msg = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({
        From: from.includes('whatsapp') ? from : `whatsapp:${from}`,
        To: para,
        ContentSid: contentSid,
      }),
      { auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    console.log('[Lista] enviada para', para, '| sid:', msg.data.sid)
    return msg.data
  } catch (err) {
    console.log('[Lista] Erro:', err.response?.data || err.message, '— fallback texto')
    // Fallback para texto simples se lista falhar
    const texto = body + '\n\n' + items.map((i, idx) => `${idx+1}. ${i.title}`).join('\n')
    return enviarMensagem(para, texto)
  }
}

// ─── Enviar botões interativos (até 3) via Twilio Content API ─────────────────
async function enviarBotoes(para, body, botoes) {
  try {
    const axios = require('axios')
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken  = process.env.TWILIO_AUTH_TOKEN
    const from       = process.env.TWILIO_WHATSAPP_NUMBER

    const contentResp = await axios.post(
      'https://content.twilio.com/v1/Content',
      {
        friendly_name: `btns_${Date.now()}`,
        language: 'pt-BR',
        variables: {},
        types: {
          'twilio/quick-reply': {
            body,
            actions: botoes.map(b => ({ type: 'QUICK_REPLY', title: b.title, id: b.id || b.title }))
          }
        }
      },
      { auth: { username: accountSid, password: authToken } }
    )

    const msg = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({ From: from, To: para, ContentSid: contentResp.data.sid }),
      { auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    console.log('[Botoes] enviados para', para)
    return msg.data
  } catch (err) {
    console.log('[Botoes] Erro:', err.response?.data || err.message, '— fallback texto')
    const texto = body + '\n\n' + botoes.map((b, i) => `${i+1}️⃣ ${b.title}`).join('\n') + '\n\n_Responda com o número._'
    return enviarMensagem(para, texto)
  }
}

// Segurança global: nunca derrubar o processo por promise rejeitada
process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err?.message || err)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err?.message || err)
})

function formatarResumoRapido(meses) {
  if (!meses?.length) return 'Nenhum dado encontrado ainda.'
  const n = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return '*Resumo dos últimos meses:*\n\n' +
    meses.map(m => `*${n[m.mes]}/${m.ano}:* ${Number(m.total_rebanho).toLocaleString('pt-BR')} cab. | Nasc: ${m.total_nascimentos} | Mort: ${m.mortalidade_pct}%`).join('\n')
}

function formatarLotes(lotes) {
  if (!lotes?.length) return 'Nenhum lote cadastrado ainda.'
  return '*Resumo por Lote:*\n\n' + lotes.map(l =>
    `*${l.lote_nome}*\n  ${l.total_ativo} ativos | ${l.machos}M ${l.femeas}F | Mort: ${l.mortalidade_pct||0}%`
  ).join('\n\n')
}

// ─── APIs ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')))
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }))
app.get('/version', (req, res) => res.json({ version: '1781817912', ts: new Date().toISOString(), node: process.version }))

app.get('/api/resumo', async (req, res) => {
  try {
    res.json({ ok: true, data: await buscarResumoMensal(parseInt(req.query.meses||'12')) })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/categorias', async (req, res) => {
  try {
    const { mes, ano, fazenda='Grupo Ricci' } = req.query
    if (!mes||!ano) return res.status(400).json({ ok: false, error: 'mes e ano obrigatórios' })
    const { data: mensal } = await supabase.from('rebanho_mensal').select('id')
      .eq('mes',mes).eq('ano',ano).eq('fazenda',fazenda).single()
    if (!mensal) return res.json({ ok: true, data: [] })
    const { data, error } = await supabase.from('rebanho_categoria').select('*')
      .eq('rebanho_id', mensal.id).order('item')
    if (error) throw new Error(error.message)
    res.json({ ok: true, data })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.get('/api/resumo/dias', async (req, res) => {
  try {
    const { mes, ano, fazenda = 'Grupo Ricci' } = req.query
    if (!mes || !ano) return res.status(400).json({ ok: false, error: 'mes e ano obrigatorios' })
    const { data, error } = await supabase
      .from('vw_resumo_mensal')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('fazenda', fazenda)
      .order('dia', { ascending: true, nullsFirst: false })
    if (error) throw new Error(error.message)
    res.json({ ok: true, data: data || [] })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.get('/api/movimentacoes', async (req, res) => {
  try {
    const { limite = 50, fazenda = 'Grupo Ricci' } = req.query
    const { data, error } = await supabase
      .from('movimentacoes_lote')
      .select('*')
      .eq('fazenda', fazenda)
      .order('data_mov', { ascending: false, nullsFirst: false })
      .limit(parseInt(limite))
    if (error) throw new Error(error.message)
    res.json({ ok: true, data: data || [] })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.post('/api/busca', async (req, res) => {
  try {
    const { query } = req.body
    if (!query) return res.status(400).json({ ok: false, error: 'query obrigatória' })
    const rag = require('./rag')
    const embedding = await rag.gerarEmbedding(query)
    const [r1, r2] = await Promise.all([
      supabase.rpc('buscar_exemplos_similares', { query_embedding: embedding, tipo_filtro: null, limite: 5 }),
      supabase.rpc('buscar_classificacao_similar', { query_embedding: embedding, limite: 3 }),
    ])
    const { agentConsulta } = require('./extracao')
    const dadosRebanho = await buscarResumoMensal(12)
    const resposta = await agentConsulta(query, dadosRebanho)
    res.json({ ok: true, resposta, exemplos_similares: r1.data || [], classificacoes: r2.data || [] })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.get('/api/anomalias', async (req, res) => {
  try {
    const { fazenda = 'Grupo Ricci', forcar = 'false' } = req.query
    const { analisarRebanho } = require('./anomalias')
    if (forcar === 'true') {
      const anomalias = await analisarRebanho(fazenda)
      return res.json({ ok: true, data: anomalias })
    }
    const { data } = await supabase.from('bot_anomalias').select('*').eq('fazenda', fazenda).eq('resolvido', false).order('detectado_em', { ascending: false })
    res.json({ ok: true, data: data || [] })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.get('/api/logs', async (req, res) => {
  try {
    const { limite = 50, status } = req.query
    let q = supabase.from('bot_logs').select('id,whatsapp,tipo,transcricao,texto_original,intencao_detectada,confianca,status,erro,salvo,recebido_em').order('recebido_em', { ascending: false }).limit(parseInt(limite))
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    res.json({ ok: true, data: data || [] })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/qualidade', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vw_qualidade_bot').select('*').limit(30)
    if (error) throw new Error(error.message)
    res.json({ ok: true, data: data || [] })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})


app.get('/api/exportar-finetuning', async (req, res) => {
  try {
    const { minimo = 10 } = req.query
    const { data: exemplos } = await supabase.from('bot_exemplos_extracao').select('transcricao, saida_json, tipo').eq('ativo', true).not('saida_json', 'is', null).order('criado_em', { ascending: false }).limit(500)
    if (!exemplos || exemplos.length < parseInt(minimo)) return res.json({ ok: false, error: 'Poucos exemplos (' + (exemplos?.length||0) + '). Minimo: ' + minimo })
    const SYSTEM_MAPA = 'Você é especialista em pecuária. Extraia dados do mapa de rebanho do texto e retorne APENAS JSON válido.'
    const SYSTEM_MOV  = 'Você é especialista em pecuária. Extraia dados de movimentação do texto e retorne APENAS JSON válido como array.'
    const linhas = exemplos.map(function(ex) {
      return JSON.stringify({ messages: [{ role:'system', content: ex.tipo==='movimentacao'?SYSTEM_MOV:SYSTEM_MAPA }, { role:'user', content:'Texto: "'+ex.transcricao+'"' }, { role:'assistant', content: JSON.stringify(ex.saida_json) }] })
    })
    const porTipo = {}; exemplos.forEach(function(e) { porTipo[e.tipo]=(porTipo[e.tipo]||0)+1 })
    res.setHeader('Content-Type','application/jsonl')
    res.setHeader('Content-Disposition','attachment; filename="finetuning_'+new Date().toISOString().substring(0,10)+'.jsonl"')
    res.setHeader('X-Total-Exemplos', exemplos.length)
    res.setHeader('X-Por-Tipo', JSON.stringify(porTipo))
    res.send(linhas.join('\n'))
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/exportar-finetuning/stats', async (req, res) => {
  try {
    const { data: exemplos } = await supabase.from('bot_exemplos_extracao').select('tipo, fonte').eq('ativo', true)
    const stats = { total: exemplos?.length||0, por_tipo:{}, por_fonte:{}, pronto:false, recomendacao:'' }
    ;(exemplos||[]).forEach(function(e) { stats.por_tipo[e.tipo]=(stats.por_tipo[e.tipo]||0)+1; stats.por_fonte[e.fonte]=(stats.por_fonte[e.fonte]||0)+1 })
    stats.pronto = stats.total >= 10
    if (stats.total < 10) stats.recomendacao = 'Precisa de mais '+(10-stats.total)+' exemplos. Continue confirmando com "sim" no bot.'
    else if (stats.total < 50) stats.recomendacao = stats.total+' exemplos — fine-tuning básico possível. Ideal: 50+.'
    else stats.recomendacao = stats.total+' exemplos — pronto para fine-tuning de qualidade!'
    res.json({ ok: true, data: stats })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})


// ─── Agente de Logs — busca e analisa logs do Fly.io automaticamente ──────────

// Endpoint para execução manual e consulta de insights
app.get('/api/insights', async (req, res) => {
  try {
    const { data } = await supabase
      .from('bot_insights')
      .select('*')
      .order('detectado_em', { ascending: false })
    res.json({ ok: true, data: data || [] })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/insights/executar', async (req, res) => {
  try {
    const resultado = await getAgenteLogs().executarCiclo({ limite: 200 })
    res.json({ ok: true, ...resultado })
  } catch(err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/lotes', async (req, res) => {
  try {
    res.json({ ok: true, data: await buscarResumoPorLote(req.query.fazenda||'Grupo Ricci') })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

app.get('/api/animais', async (req, res) => {
  try {
    const { lote_id, fazenda='Grupo Ricci', status='ativo' } = req.query
    let q = supabase.from('animais').select('*, lotes(nome)').eq('fazenda',fazenda).eq('status',status).order('brinco')
    if (lote_id) q = q.eq('lote_id', lote_id)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    res.json({ ok: true, data })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// ─── API endpoints para dashboard (usa service key no servidor) ──────────────
const { createClient: createClientDash } = require('@supabase/supabase-js')
let _sbDash = null
function getSbDash() {
  if (!_sbDash) _sbDash = createClientDash(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { global: { WebSocket: require('ws') } }
  )
  return _sbDash
}

app.get('/api/dashboard/movimentacoes', async (req, res) => {
  try {
    const { fazenda, desde, tipo } = req.query
    console.log('[Dashboard] movimentacoes:', { fazenda, desde, tipo })
    let q = getSbDash().from('movimentacoes_lote').select('id,fazenda,tipo,categoria,quantidade,data_mov,lote_id').order('data_mov', { ascending: false }).limit(200)
    if (desde) q = q.gte('data_mov', desde)
    // 'Grupo Ricci' = grupo econômico = todas as fazendas, não filtrar
    if (fazenda && fazenda !== 'Grupo Ricci' && fazenda !== 'todos') q = q.eq('fazenda', fazenda)
    if (tipo) q = q.eq('tipo', tipo)
    const { data, error } = await q
    if (error) { console.log('[Dashboard] erro:', error); return res.status(500).json({ error: error.message }) }
    res.json(data || [])
  } catch(e) { console.log('[Dashboard] catch:', e.message); res.status(500).json({ error: e.message }) }
})

app.get('/api/dashboard/lotes', async (req, res) => {
  try {
    const { fazenda } = req.query
    let q = getSbDash().from('lotes').select('id,nome,finalidade,fazenda_id,fazendas(nome)').eq('ativo', true).order('nome')
    if (fazenda && fazenda !== 'Grupo Ricci') {
      const { data: fazs } = await getSbDash().from('fazendas').select('id').eq('nome', fazenda)
      if (fazs?.[0]) q = q.eq('fazenda_id', fazs[0].id)
    }
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dashboard/fazendas', async (req, res) => {
  try {
    const { data, error } = await getSupabase().from('fazendas').select('id,nome,tipo,nome_normalizado').eq('ativo', true).order('nome')
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dashboard/alertas', async (req, res) => {
  try {
    const { data, error } = await getSbDash().from('bot_anomalias').select('*').order('detectado_em', { ascending: false }).limit(20)
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── Dashboard de gestão ────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'))
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  // ─── Iniciar agentes após servidor subir ─────────────────
  const agenteAnalise = require('./agente_analise')
  agenteAnalise.iniciarAgendamento()
  console.log(`Servidor na porta ${PORT}`)
  setTimeout(() => {
    supabase.from('configuracoes').select('chave, valor').then(({ data }) => {
      if (data) data.forEach(c => { process.env['CFG_'+c.chave.toUpperCase()] = c.valor })
      console.log('Configurações carregadas:', (data||[]).length)
    }).catch(() => {})
    setTimeout(function() { require('./anomalias').analisarRebanho('Grupo Ricci').catch(function(){}) }, 20000)
    // Agente de logs — primeira execução após 30s
    setTimeout(function() {
      getAgenteLogs().executarCiclo({ limite: 200 }).catch(e => console.log('AgenteLogs startup:', e.message))
    }, 30000)
  }, 10000)

  // Agente de logs — ciclo a cada 10 minutos
  setInterval(function() {
    getAgenteLogs().executarCiclo({ limite: 200 }).catch(e => console.log('AgenteLogs cron:', e.message))
  }, 10 * 60 * 1000)
})
