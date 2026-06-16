// ============================================================
// agente_analise.js — Agente de análise e alertas proativos
// Detecta anomalias e envia alertas via WhatsApp
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

// ─── Regras de alerta ─────────────────────────────────────────
const REGRAS = [
  {
    id: 'mortalidade_bezerros_alta',
    descricao: 'Mortalidade de bezerros acima do limite',
    verificar: async (fazenda, movs) => {
      const bezerros = movs.filter(m =>
        m.tipo === 'morte' &&
        (m.categoria?.includes('Bezerr') || m.categoria?.includes('1.1') || m.categoria?.includes('2.1'))
      )
      const totalMortes = bezerros.reduce((s, m) => s + m.quantidade, 0)
      if (totalMortes >= 3) {
        return {
          nivel: totalMortes >= 5 ? 'critico' : 'alerta',
          mensagem: `⚠️ *Alerta ${fazenda}*: ${totalMortes} morte(s) de bezerros registrada(s) nos últimos 7 dias. Índice acima do normal (máx 2/semana). Verificar causas: diarreia neonatal, carência mineral ou tristeza parasitária.`
        }
      }
      return null
    }
  },
  {
    id: 'mortalidade_adultos_alta',
    descricao: 'Mortalidade de adultos acima do limite',
    verificar: async (fazenda, movs) => {
      const adultos = movs.filter(m =>
        m.tipo === 'morte' &&
        !m.categoria?.includes('Bezerr') &&
        !m.categoria?.includes('0-8') &&
        !m.categoria?.includes('0-2')
      )
      const totalMortes = adultos.reduce((s, m) => s + m.quantidade, 0)
      if (totalMortes >= 2) {
        return {
          nivel: 'alerta',
          mensagem: `⚠️ *Alerta ${fazenda}*: ${totalMortes} morte(s) de animais adultos nos últimos 7 dias. Acima do normal. Verificar se há surto sanitário ou problema de pastagem.`
        }
      }
      return null
    }
  },
  {
    id: 'sem_registro_semanal',
    descricao: 'Fazenda sem registro há mais de 7 dias',
    verificar: async (fazenda, movs, ultimoRegistro) => {
      if (!ultimoRegistro) return null
      const dias = Math.floor((Date.now() - new Date(ultimoRegistro).getTime()) / (1000 * 60 * 60 * 24))
      if (dias >= 7) {
        return {
          nivel: 'aviso',
          mensagem: `📋 *Lembrete ${fazenda}*: Nenhum registro nos últimos ${dias} dias. Não esqueça de atualizar o mapa de rebanho semanalmente.`
        }
      }
      return null
    }
  },
  {
    id: 'mortalidade_mensal_critica',
    descricao: 'Taxa de mortalidade mensal crítica',
    verificar: async (fazenda, movs, ultimoRegistro, mensal) => {
      if (!mensal) return null
      const mortalidade = parseFloat(mensal.mortalidade_pct || 0)
      if (mortalidade >= 3) {
        return {
          nivel: 'critico',
          mensagem: `🔴 *CRÍTICO ${fazenda}*: Taxa de mortalidade mensal em ${mortalidade.toFixed(2)}% — acima do limite crítico de 3%. Ação imediata necessária. Contate seu veterinário.`
        }
      } else if (mortalidade >= 2) {
        return {
          nivel: 'alerta',
          mensagem: `⚠️ *Alerta ${fazenda}*: Taxa de mortalidade em ${mortalidade.toFixed(2)}% este mês — acima do normal (máx 2%). Monitorar de perto.`
        }
      }
      return null
    }
  },
  {
    id: 'pico_nascimentos',
    descricao: 'Período de parição intenso — requer atenção',
    verificar: async (fazenda, movs) => {
      const nascimentos = movs.filter(m => m.tipo === 'nascimento')
      const total = nascimentos.reduce((s, m) => s + m.quantidade, 0)
      if (total >= 10) {
        return {
          nivel: 'info',
          mensagem: `🐄 *Info ${fazenda}*: ${total} nascimentos registrados nos últimos 7 dias — período de parição intenso. Redobrar atenção com colostro nas primeiras 6h e higiene das áreas de parto.`
        }
      }
      return null
    }
  }
]

// ─── Verificar se alerta já foi enviado recentemente ─────────
async function alertaJaEnviado(fazenda, tipoAlerta) {
  try {
    const sb = getSb()
    const { data } = await sb
      .from('bot_anomalias')
      .select('id, detectado_em')
      .eq('fazenda', fazenda)
      .eq('tipo', tipoAlerta)
      .eq('resolvido', false)
      .gte('detectado_em', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .limit(1)
    return data?.length > 0
  } catch { return false }
}

// ─── Registrar alerta no banco ────────────────────────────────
async function registrarAlerta(fazenda, tipo, descricao) {
  try {
    const sb = getSb()
    await sb.from('bot_anomalias').insert({
      fazenda, tipo,
      descricao,
      resolvido: false,
      detectado_em: new Date().toISOString()
    })
  } catch (err) {
    console.log('[ANALISE] Erro ao registrar alerta:', err.message)
  }
}

// ─── Enviar mensagem via Twilio ───────────────────────────────
async function enviarAlerta(whatsapp, mensagem) {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_WHATSAPP_NUMBER

    const resp = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      new URLSearchParams({
        From: from,
        To: whatsapp,
        Body: mensagem
      }),
      {
        auth: { username: sid, password: token },
        timeout: 10000
      }
    )
    console.log(`[ANALISE] Alerta enviado para ${whatsapp}: ${resp.data.sid}`)
    return true
  } catch (err) {
    console.log('[ANALISE] Erro ao enviar alerta:', err.message)
    return false
  }
}

// ─── Analisar uma fazenda ─────────────────────────────────────
async function analisarFazenda(fazenda, usuarios) {
  const sb = getSb()
  const alertasEnviados = []

  try {
    // Buscar movimentações dos últimos 7 dias
    const { data: movs } = await sb
      .from('movimentacoes_lote')
      .select('tipo, categoria, quantidade, data_movimentacao, whatsapp_de')
      .eq('fazenda', fazenda)
      .gte('data_movimentacao', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('data_movimentacao', { ascending: false })

    // Buscar último registro
    const { data: ultimoLog } = await sb
      .from('bot_logs')
      .select('recebido_em')
      .in('whatsapp', usuarios.map(u => u.whatsapp))
      .eq('status', 'salvo')
      .order('recebido_em', { ascending: false })
      .limit(1)
      .single()

    // Buscar resumo mensal atual
    const { data: mensal } = await sb
      .from('vw_resumo_mensal')
      .select('*')
      .eq('fazenda', fazenda)
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })
      .limit(1)
      .single()

    // Executar cada regra
    for (const regra of REGRAS) {
      try {
        const resultado = await regra.verificar(
          fazenda,
          movs || [],
          ultimoLog?.recebido_em,
          mensal
        )

        if (!resultado) continue

        // Verificar se já enviamos este alerta nas últimas 48h
        const jaEnviado = await alertaJaEnviado(fazenda, regra.id)
        if (jaEnviado) {
          console.log(`[ANALISE] Alerta ${regra.id} já enviado recentemente para ${fazenda}`)
          continue
        }

        // Registrar no banco
        await registrarAlerta(fazenda, regra.id, resultado.mensagem)

        // Enviar para todos os gestores da fazenda
        for (const usuario of usuarios) {
          if (usuario.funcao === 'gestor' || usuario.funcao === 'admin') {
            await enviarAlerta(usuario.whatsapp, resultado.mensagem)
            alertasEnviados.push({ fazenda, regra: regra.id, nivel: resultado.nivel, para: usuario.whatsapp })
          }
        }
      } catch (err) {
        console.log(`[ANALISE] Erro na regra ${regra.id}:`, err.message)
      }
    }
  } catch (err) {
    console.log(`[ANALISE] Erro ao analisar ${fazenda}:`, err.message)
  }

  return alertasEnviados
}

// ─── Ciclo principal de análise ───────────────────────────────
async function executarCiclo() {
  console.log('[ANALISE] Iniciando ciclo de análise...')
  const sb = getSb()

  try {
    // Buscar todos os usuários agrupados por fazenda
    const { data: usuarios } = await sb
      .from('usuarios')
      .select('whatsapp, nome, fazenda, funcao')
      .not('fazenda', 'is', null)

    if (!usuarios?.length) {
      console.log('[ANALISE] Nenhum usuário com fazenda encontrado')
      return
    }

    // Agrupar por fazenda
    const porFazenda = {}
    for (const u of usuarios) {
      if (!porFazenda[u.fazenda]) porFazenda[u.fazenda] = []
      porFazenda[u.fazenda].push(u)
    }

    console.log(`[ANALISE] Analisando ${Object.keys(porFazenda).length} fazenda(s)...`)

    let totalAlertas = 0
    for (const [fazenda, usuariosFazenda] of Object.entries(porFazenda)) {
      const alertas = await analisarFazenda(fazenda, usuariosFazenda)
      totalAlertas += alertas.length
      if (alertas.length > 0) {
        console.log(`[ANALISE] ${fazenda}: ${alertas.length} alerta(s) enviado(s)`)
      }
    }

    console.log(`[ANALISE] Ciclo concluído — ${totalAlertas} alerta(s) enviado(s)`)
  } catch (err) {
    console.log('[ANALISE] Erro no ciclo:', err.message)
  }
}

// ─── Iniciar agendamento ──────────────────────────────────────
function iniciarAgendamento() {
  // Rodar a cada 6 horas
  const INTERVALO = 6 * 60 * 60 * 1000

  // Primeira execução após 1 minuto (dar tempo pro servidor subir)
  setTimeout(() => {
    executarCiclo()
    setInterval(executarCiclo, INTERVALO)
  }, 60 * 1000)

  console.log('[ANALISE] Agendamento iniciado — ciclo a cada 6 horas')
}

module.exports = { executarCiclo, iniciarAgendamento, analisarFazenda }
