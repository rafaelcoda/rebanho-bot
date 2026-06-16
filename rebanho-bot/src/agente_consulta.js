// ============================================================
// agente_consulta.js — Agente de consulta RAG para o bot
// Integra knowledge_base, rebanho_snapshots e memorias_fazenda
// ============================================================

const axios = require('axios')
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

let _sb = null
function getSb() {
  if (!_sb) _sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { global: { WebSocket: ws } }
  )
  return _sb
}

// ─── Gerar embedding via OpenAI ──────────────────────────────
async function gerarEmbedding(texto) {
  const resp = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: 'text-embedding-3-small', input: texto },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 10000 }
  )
  return resp.data.data[0].embedding
}

// ─── Buscar contexto relevante para uma pergunta ─────────────
async function buscarContexto(pergunta, fazenda) {
  try {
    const embedding = await gerarEmbedding(pergunta)
    const sb = getSb()

    // Buscar em paralelo nas 3 fontes
    const [conhecimento, snapshots, memorias] = await Promise.all([
      sb.rpc('buscar_conhecimento', {
        query_embedding: embedding,
        limite: 3,
        filtro_categoria: null
      }),
      sb.rpc('buscar_snapshots_similares', {
        query_embedding: embedding,
        fazenda_filter: fazenda,
        limite: 2
      }),
      sb.rpc('buscar_memorias', {
        query_embedding: embedding,
        fazenda_filter: fazenda,
        limite: 3,
        filtro_tipo: null
      })
    ])

    const ctx = []

    if (conhecimento.data?.length) {
      ctx.push('=== Conhecimento técnico ===')
      conhecimento.data.forEach(k => {
        ctx.push(`[${k.categoria}] ${k.titulo}\n${k.conteudo.substring(0, 300)}`)
      })
    }

    if (snapshots.data?.length) {
      ctx.push('\n=== Histórico do rebanho ===')
      snapshots.data.forEach(s => {
        ctx.push(`Semana ${s.semana}: ${s.resumo_texto}`)
      })
    }

    if (memorias.data?.length) {
      ctx.push('\n=== Memória da fazenda ===')
      memorias.data.forEach(m => {
        ctx.push(`[${m.tipo}] ${m.conteudo.substring(0, 300)}`)
      })
    }

    return ctx.join('\n')
  } catch (err) {
    console.log('[RAG] Erro ao buscar contexto:', err.message)
    return ''
  }
}

// ─── Buscar dados operacionais via SQL ────────────────────────
async function buscarDadosOperacionais(pergunta, fazenda) {
  try {
    const sb = getSb()

    // Determinar tipo de consulta
    const perguntaLower = pergunta.toLowerCase()
    const resultados = {}

    // Movimentações recentes
    if (perguntaLower.match(/nascimento|morte|compra|venda|movi/)) {
      const { data } = await sb
        .from('movimentacoes_lote')
        .select('tipo, categoria, quantidade, data_movimentacao, lote_nome')
        .eq('fazenda', fazenda)
        .gte('data_movimentacao', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('data_movimentacao', { ascending: false })
        .limit(20)

      if (data?.length) resultados.movimentacoes = data
    }

    // Resumo mensal
    if (perguntaLower.match(/total|rebanho|quantos|mês|mensal|resumo/)) {
      const { data } = await sb
        .from('vw_resumo_mensal')
        .select('*')
        .eq('fazenda', fazenda)
        .order('ano', { ascending: false })
        .order('mes', { ascending: false })
        .limit(3)

      if (data?.length) resultados.resumo_mensal = data
    }

    return Object.keys(resultados).length ? JSON.stringify(resultados, null, 2) : ''
  } catch (err) {
    console.log('[RAG] Erro ao buscar dados operacionais:', err.message)
    return ''
  }
}

// ─── Responder pergunta via RAG + LLM ─────────────────────────
async function responderPergunta(pergunta, fazenda, nomeUsuario) {
  try {
    console.log(`[RAG] Pergunta: "${pergunta}" | Fazenda: ${fazenda}`)

    // Buscar contexto em paralelo
    const [contextoRAG, dadosSQL] = await Promise.all([
      buscarContexto(pergunta, fazenda),
      buscarDadosOperacionais(pergunta, fazenda)
    ])

    const sistemaPrompt = `Você é um assistente especializado em gestão de rebanho bovino do Grupo Ricci.
Responda em português brasileiro informal, como se fosse uma conversa por WhatsApp.
Use os dados fornecidos para responder com precisão.
Se não tiver informação suficiente, diga claramente.
IMPORTANTE: Não use markdown (sem #, ##, *, **, listas com •). Use texto simples com quebras de linha.
Seja direto e conciso — máximo 5 linhas.`

    const contextoParts = []
    if (contextoRAG) contextoParts.push(`CONTEXTO DE CONHECIMENTO:\n${contextoRAG}`)
    if (dadosSQL) contextoParts.push(`DADOS OPERACIONAIS DA FAZENDA:\n${dadosSQL}`)

    const userPrompt = contextoParts.length
      ? `${contextoParts.join('\n\n')}\n\nPERGUNTA de ${nomeUsuario || 'usuário'}: ${pergunta}`
      : `PERGUNTA de ${nomeUsuario || 'usuário'}: ${pergunta}`

    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        max_tokens: 500,
        temperature: 0.3,
        messages: [
          { role: 'system', content: sistemaPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 20000
      }
    )

    const resposta = resp.data.choices[0].message.content.trim()
    console.log(`[RAG] Resposta gerada (${resposta.length} chars)`)
    return resposta
  } catch (err) {
    console.log('[RAG] Erro ao responder:', err.message)
    return null
  }
}

// ─── Detectar se é uma pergunta (vs registro) ─────────────────
function ehPergunta(texto) {
  if (!texto) return false
  const t = texto.toLowerCase().trim()

  // Palavras que indicam pergunta
  const indicadores = [
    /^(quanto|quantos|quantas)\b/,
    /^(qual|quais)\b/,
    /^(como|quando|onde|por que|porque)\b/,
    /^(me (diz|fala|conta|mostra))/,
    /^(tem|teve|houve|ocorreu)\b/,
    /\?$/,
    /\b(total|resumo|relatório|média|taxa|índice)\b/,
    /\b(histórico|evolução|comparar|diferença)\b/,
    /\b(rebanho|animais|cabeças)\b.*\b(hoje|agora|atual|mês)\b/,
    /\b(mortalidade|natalidade|produtividade)\b/,
    /^(o que aconteceu|o que foi)/,
    /^(me (passa|envia|manda))/,
  ]

  // NÃO é pergunta se começa com números/categorias (é registro)
  const ehRegistro = [
    /^\d+\s+(bezerr|novilh|vac|boi|garrote|touro)/i,
    /^(nasceu|nasceram|morreu|morreram|comprei|vendi)/i,
    /^(registra|salva|anota)/i,
  ]

  if (ehRegistro.some(r => r.test(t))) return false
  return indicadores.some(r => r.test(t))
}

// ─── Salvar memória gerada automaticamente ────────────────────
async function salvarMemoria(fazenda, tipo, conteudo, fonte = 'agente') {
  try {
    const embedding = await gerarEmbedding(conteudo)
    const sb = getSb()
    await sb.from('memorias_fazenda').insert({
      fazenda, tipo, conteudo, fonte, embedding,
      relevancia: tipo === 'alerta' ? 8 : 5
    })
    console.log(`[RAG] Memória salva: ${tipo} para ${fazenda}`)
  } catch (err) {
    console.log('[RAG] Erro ao salvar memória:', err.message)
  }
}

// ─── Gerar e salvar snapshot semanal ─────────────────────────
async function gerarSnapshot(fazenda) {
  try {
    const sb = getSb()
    const semana = new Date()
    semana.setDate(semana.getDate() - semana.getDay()) // domingo
    const semanaStr = semana.toISOString().split('T')[0]

    // Buscar dados da semana
    const { data: movs } = await sb
      .from('movimentacoes_lote')
      .select('tipo, categoria, quantidade')
      .eq('fazenda', fazenda)
      .gte('data_movimentacao', semanaStr)

    const { data: mensal } = await sb
      .from('vw_resumo_mensal')
      .select('*')
      .eq('fazenda', fazenda)
      .limit(1)
      .single()

    if (!mensal) return

    const resumo = movs?.reduce((acc, m) => {
      acc[m.tipo] = (acc[m.tipo] || 0) + m.quantidade
      return acc
    }, {})

    const resumoTexto = [
      `Semana ${semanaStr} — ${fazenda}:`,
      `Total rebanho: ${mensal.total_rebanho} animais`,
      `Machos: ${mensal.total_machos} | Fêmeas: ${mensal.total_femeas}`,
      resumo?.nascimento ? `Nascimentos: ${resumo.nascimento}` : '',
      resumo?.morte ? `Mortes: ${resumo.morte}` : '',
      resumo?.compra ? `Compras: ${resumo.compra}` : '',
      resumo?.venda ? `Vendas: ${resumo.venda}` : '',
      `Mortalidade: ${mensal.mortalidade_pct}%`,
    ].filter(Boolean).join(' | ')

    const embedding = await gerarEmbedding(resumoTexto)

    await sb.from('rebanho_snapshots').upsert({
      fazenda,
      semana: semanaStr,
      total_animais: mensal.total_rebanho,
      total_machos: mensal.total_machos,
      total_femeas: mensal.total_femeas,
      nascimentos: resumo?.nascimento || 0,
      mortes: resumo?.morte || 0,
      compras: resumo?.compra || 0,
      vendas: resumo?.venda || 0,
      mortalidade_pct: mensal.mortalidade_pct,
      resumo_texto: resumoTexto,
      embedding
    }, { onConflict: 'fazenda,semana' })

    console.log(`[RAG] Snapshot salvo para ${fazenda} semana ${semanaStr}`)
  } catch (err) {
    console.log('[RAG] Erro ao gerar snapshot:', err.message)
  }
}

module.exports = {
  responderPergunta,
  ehPergunta,
  salvarMemoria,
  gerarSnapshot,
  gerarEmbedding
}
