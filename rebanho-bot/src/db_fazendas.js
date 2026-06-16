// ============================================================
// db_fazendas.js — Funções para resolver nomes → UUIDs
// Busca fazendas, pastos, lotes e tipos de animal por nome
// ============================================================

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

// Normalizar texto para matching (lowercase, sem acento)
function normalizar(texto) {
  if (!texto) return ''
  return texto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// ─── Buscar fazenda por nome (texto livre → {id, nome}) ───────
async function resolverFazenda(nomeBruto) {
  if (!nomeBruto) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  // Busca exata primeiro
  const { data: exata } = await sb
    .from('fazendas')
    .select('id, nome, nome_normalizado')
    .eq('nome_normalizado', norm)
    .eq('ativo', true)
    .single()

  if (exata) return exata

  // Busca parcial
  const { data: todas } = await sb
    .from('fazendas')
    .select('id, nome, nome_normalizado')
    .eq('ativo', true)

  if (!todas?.length) return null

  // Verificar se o nome buscado contém ou está contido no nome da fazenda
  const match = todas.find(f =>
    f.nome_normalizado.includes(norm) ||
    norm.includes(f.nome_normalizado)
  )

  return match || null
}

// ─── Buscar lote por nome dentro de uma fazenda ───────────────
async function resolverLote(nomeBruto, fazendaId) {
  if (!nomeBruto) return null
  const sb = getSb()
  const norm = normalizar(nomeBruto)

  const { data: lotes } = await sb
    .from('lotes')
    .select('id, nome, finalidade')
    .eq('fazenda_id', fazendaId)
    .eq('ativo', true)

  if (!lotes?.length) return null

  // Busca exata
  const exato = lotes.find(l => normalizar(l.nome) === norm)
  if (exato) return exato

  // Busca parcial
  const parcial = lotes.find(l =>
    normalizar(l.nome).includes(norm) ||
    norm.includes(normalizar(l.nome))
  )

  return parcial || null
}

// ─── Buscar tipo de animal por nome ───────────────────────────
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

  const parcial = tipos.find(t =>
    normalizar(t.nome).includes(norm) ||
    norm.includes(normalizar(t.nome))
  )

  // Se não encontrou nada, retorna "Outros"
  return parcial || tipos.find(t => normalizar(t.nome) === 'outros') || null
}

// ─── Listar lotes de uma fazenda (para o bot mostrar opções) ──
async function listarLotes(fazendaId) {
  const sb = getSb()
  const { data } = await sb
    .from('lotes')
    .select('id, nome, finalidade')
    .eq('fazenda_id', fazendaId)
    .eq('ativo', true)
    .order('nome')
  return data || []
}

// ─── Listar fazendas ativas ───────────────────────────────────
async function listarFazendas() {
  const sb = getSb()
  const { data } = await sb
    .from('fazendas')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
  return data || []
}

// ─── Resolver contexto completo de um registro ────────────────
// Recebe texto bruto e retorna {fazenda_id, lote_id, tipo_id, fazenda_nome, lote_nome, tipo_nome}
async function resolverContexto(fazendaNome, loteNome, tipoNome) {
  const resultado = {
    fazenda_id: null, fazenda_nome: null,
    lote_id: null, lote_nome: null,
    tipo_id: null, tipo_nome: null
  }

  // Resolver fazenda
  if (fazendaNome) {
    const fazenda = await resolverFazenda(fazendaNome)
    if (fazenda) {
      resultado.fazenda_id = fazenda.id
      resultado.fazenda_nome = fazenda.nome
    }
  }

  // Resolver lote (precisa da fazenda)
  if (loteNome && resultado.fazenda_id) {
    const lote = await resolverLote(loteNome, resultado.fazenda_id)
    if (lote) {
      resultado.lote_id = lote.id
      resultado.lote_nome = lote.nome
    }
  }

  // Resolver tipo de animal
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
  resolverLote,
  resolverTipoAnimal,
  resolverContexto,
  listarLotes,
  listarFazendas,
  normalizar
}
