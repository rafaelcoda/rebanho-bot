// db_fazendas.js — Funções para resolver nomes → UUIDs
// Hierarquia: Fazenda > Subdivisão (Pasto/Confinamento/Piquete) > Lote

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

function normalizar(texto) {
  if (!texto) return ''
  return texto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// ─── Fazenda ──────────────────────────────────────────────────
async function resolverFazenda(nomeBruto) {
  if (!nomeBruto) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  const { data: exata } = await sb
    .from('fazendas')
    .select('id, nome, nome_normalizado')
    .eq('nome_normalizado', norm)
    .eq('ativo', true)
    .single()
  if (exata) return exata

  const { data: todas } = await sb
    .from('fazendas')
    .select('id, nome, nome_normalizado')
    .eq('ativo', true)
  if (!todas?.length) return null

  return todas.find(f =>
    f.nome_normalizado.includes(norm) || norm.includes(f.nome_normalizado)
  ) || null
}

// ─── Subdivisão (Pasto/Confinamento/Piquete) ──────────────────
async function resolverSubdivisao(nomeBruto, fazendaId) {
  if (!nomeBruto || !fazendaId) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  const { data: subs } = await sb
    .from('subdivisoes')
    .select('id, nome, tipo, numero')
    .eq('fazenda_id', fazendaId)
    .eq('ativo', true)
  if (!subs?.length) return null

  const exato = subs.find(s => normalizar(s.nome) === norm)
  if (exato) return exato

  return subs.find(s =>
    normalizar(s.nome).includes(norm) ||
    norm.includes(normalizar(s.nome)) ||
    (s.tipo && norm.includes(s.tipo))
  ) || null
}

// ─── Lote ─────────────────────────────────────────────────────
async function resolverLote(nomeBruto, fazendaId) {
  if (!nomeBruto || !fazendaId) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  const { data: lotes } = await sb
    .from('lotes')
    .select('id, nome, finalidade, numero')
    .eq('fazenda_id', fazendaId)
    .eq('ativo', true)
  if (!lotes?.length) return null

  const exato = lotes.find(l => normalizar(l.nome) === norm)
  if (exato) return exato

  return lotes.find(l =>
    normalizar(l.nome).includes(norm) || norm.includes(normalizar(l.nome))
  ) || null
}

// ─── Tipo de animal ───────────────────────────────────────────
async function resolverTipoAnimal(nomeBruto) {
  if (!nomeBruto) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  const { data: tipos } = await sb
    .from('tipos_animal')
    .select('id, nome')
    .eq('ativo', true)
  if (!tipos?.length) return null

  const exato = tipos.find(t => normalizar(t.nome) === norm)
  if (exato) return exato

  return tipos.find(t =>
    normalizar(t.nome).includes(norm) || norm.includes(normalizar(t.nome))
  ) || tipos.find(t => normalizar(t.nome) === 'outros') || null
}

// ─── Listar para menus ────────────────────────────────────────
async function listarFazendas() {
  const { data } = await getSb().from('fazendas').select('id, nome').eq('ativo', true).order('nome')
  return data || []
}

async function listarSubdivisoes(fazendaId) {
  const { data } = await getSb().from('subdivisoes').select('id, nome, tipo, numero, area_ha')
    .eq('fazenda_id', fazendaId).eq('ativo', true).order('nome')
  return data || []
}

async function listarLotes(fazendaId) {
  const { data } = await getSb().from('lotes').select('id, nome, finalidade, numero')
    .eq('fazenda_id', fazendaId).eq('ativo', true).order('nome')
  return data || []
}

// ─── Resolver contexto completo ───────────────────────────────
async function resolverContexto(fazendaNome, subdivisaoNome, loteNome, tipoNome) {
  const resultado = {
    fazenda_id: null, fazenda_nome: null,
    subdivisao_id: null, subdivisao_nome: null,
    lote_id: null, lote_nome: null,
    tipo_id: null, tipo_nome: null
  }

  if (fazendaNome) {
    const fazenda = await resolverFazenda(fazendaNome)
    if (fazenda) {
      resultado.fazenda_id = fazenda.id
      resultado.fazenda_nome = fazenda.nome
    }
  }

  if (subdivisaoNome && resultado.fazenda_id) {
    const sub = await resolverSubdivisao(subdivisaoNome, resultado.fazenda_id)
    if (sub) {
      resultado.subdivisao_id = sub.id
      resultado.subdivisao_nome = sub.nome
    }
  }

  if (loteNome && resultado.fazenda_id) {
    const lote = await resolverLote(loteNome, resultado.fazenda_id)
    if (lote) {
      resultado.lote_id = lote.id
      resultado.lote_nome = lote.nome
    }
  }

  if (tipoNome) {
    const tipo = await resolverTipoAnimal(tipoNome)
    if (tipo) {
      resultado.tipo_id = tipo.id
      resultado.tipo_nome = tipo.nome
    }
  }

  return resultado
}

module.exports = {
  resolverFazenda,
  resolverSubdivisao,
  resolverLote,
  resolverTipoAnimal,
  resolverContexto,
  listarFazendas,
  listarSubdivisoes,
  listarLotes,
  normalizar
}
