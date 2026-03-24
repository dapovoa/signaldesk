#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const DEFAULT_SOURCE_DIR = path.join(os.homedir(), '.config', 'signaldesk', 'avatar', 'sources')
const DEFAULT_EXTENSIONS = new Set(['.md', '.txt', '.json'])

const DEFAULT_QUERIES = [
  {
    id: 'intro',
    text: 'Tell me about yourself and your recent infrastructure experience.',
    expectedAny: ['infrastructure', 'operations', 'production', 'linux']
  },
  {
    id: 'incident',
    text: 'Give me one production incident and how you handled it.',
    expectedAny: ['incident', 'production', 'impact', 'root cause', 'logs']
  },
  {
    id: 'pipeline',
    text: 'Describe a data pipeline project you built.',
    expectedAny: ['pipeline', 'postgresql', 'prefect', 'docker', 'validation']
  },
  {
    id: 'tradeoff',
    text: 'Tell me about a technical tradeoff or decision you made.',
    expectedAny: ['tradeoff', 'decision', 'cost', 'priorit']
  },
  {
    id: 'debugging',
    text: 'Walk me through a debugging case in production.',
    expectedAny: ['debug', 'error', 'latency', 'logs', 'validation']
  }
]

const parseArgs = () => {
  const args = {}
  for (const raw of process.argv.slice(2)) {
    const cleaned = raw.replace(/^--/, '')
    const [key, ...rest] = cleaned.split('=')
    args[key] = rest.length > 0 ? rest.join('=') : '1'
  }
  return args
}

const args = parseArgs()

const parseCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const OLLAMA_URL = String(args.ollama || DEFAULT_OLLAMA_URL).replace(/\/+$/, '')
const SOURCE_DIR = path.resolve(args.sourceDir || DEFAULT_SOURCE_DIR)
const TOP_K = Number(args.topK || 5)
const BATCH_SIZE = Math.max(1, Number(args.batchSize || 24))
const MAX_CHUNKS = Math.max(0, Number(args.maxChunks || 0))
const STRICT_EXTENSIONS = args.extensions ? new Set(parseCsv(args.extensions).map((ext) => ext.toLowerCase())) : DEFAULT_EXTENSIONS

const MODELS_FILTER = args.models ? new Set(parseCsv(args.models)) : null
const ALL_MODELS = args.allModels === '1' || args.allModels === 'true'
const QUERY_FILE = args.queryFile ? path.resolve(args.queryFile) : null

const nowMs = () => Number(process.hrtime.bigint() / 1000000n)

const readQueries = () => {
  if (!QUERY_FILE) return DEFAULT_QUERIES
  const raw = JSON.parse(fs.readFileSync(QUERY_FILE, 'utf8'))
  if (!Array.isArray(raw)) {
    throw new Error('queryFile must be a JSON array')
  }

  return raw.map((entry, idx) => {
    const text = String(entry.text || '').trim()
    if (!text) {
      throw new Error(`queryFile entry ${idx} is missing text`)
    }
    return {
      id: String(entry.id || `q${idx + 1}`),
      text,
      expectedAny: Array.isArray(entry.expectedAny) ? entry.expectedAny.map((v) => String(v).toLowerCase()) : []
    }
  })
}

const normalizeWhitespace = (value) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

const collectFiles = (root) => {
  const files = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (STRICT_EXTENSIONS.has(ext)) {
        files.push(fullPath)
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

const splitLong = (value, maxChars = 800) => {
  if (value.length <= maxChars) return [value]
  const out = []
  let cursor = 0
  while (cursor < value.length) {
    const chunk = value.slice(cursor, cursor + maxChars)
    out.push(chunk.trim())
    cursor += maxChars
  }
  return out.filter(Boolean)
}

const toChunks = (filePath, content) => {
  const normalized = normalizeWhitespace(content)
  if (!normalized) return []

  const segments = normalized
    .split(/\n{2,}|(?=^#)/gm)
    .map((part) => part.trim())
    .filter((part) => part.length >= 60)
    .flatMap((part) => splitLong(part, 850))
    .filter((part) => part.length >= 80)

  return segments.map((segment, idx) => ({
    id: `${filePath}::${idx}`,
    filePath,
    fileName: path.basename(filePath),
    content: segment
  }))
}

const cosine = (a, b) => {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const av = Number(a[i] || 0)
    const bv = Number(b[i] || 0)
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }

  return response.json()
}

const listOllamaModels = async () => {
  const response = await fetch(`${OLLAMA_URL}/api/tags`)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to list models from ${OLLAMA_URL}/api/tags: ${response.status} ${body}`)
  }

  const payload = await response.json()
  const models = Array.isArray(payload.models) ? payload.models : []
  return models
    .map((m) => ({
      name: String(m.name || m.model || ''),
      size: Number(m.size || 0),
      families: Array.isArray(m.details?.families)
        ? m.details.families.map((v) => String(v).toLowerCase())
        : [],
      family: String(m.details?.family || '').toLowerCase()
    }))
    .filter((m) => Boolean(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const isLikelyEmbeddingModel = (model) => {
  const name = model.name.toLowerCase()
  const family = model.family || ''
  const families = model.families || []

  if (/(embed|embedding|bge|mxbai|nomic|e5|jina)/.test(name)) {
    return true
  }

  if (family === 'bert' || families.includes('bert')) {
    return true
  }

  return false
}

const embedBatch = async (model, input) => {
  const payload = await postJson(`${OLLAMA_URL}/api/embed`, { model, input })
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length === 0) {
    throw new Error('Embedding API returned no embeddings')
  }

  return payload.embeddings
}

const supportsEmbedding = async (model) => {
  try {
    const vectors = await embedBatch(model, ['embedding probe'])
    const dims = vectors[0]?.length || 0
    return { ok: dims > 0, dimensions: dims }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), dimensions: 0 }
  }
}

const embedAllChunks = async (model, chunks) => {
  const vectors = []
  let cursor = 0
  while (cursor < chunks.length) {
    const slice = chunks.slice(cursor, cursor + BATCH_SIZE)
    const embedded = await embedBatch(
      model,
      slice.map((item) => item.content)
    )
    for (let i = 0; i < slice.length; i += 1) {
      vectors.push({ chunk: slice[i], vector: embedded[i] || [] })
    }
    cursor += slice.length
  }
  return vectors
}

const evaluateModel = async (model, chunks, queries) => {
  const indexStart = nowMs()
  const embeddedChunks = await embedAllChunks(model, chunks)
  const indexMs = nowMs() - indexStart

  const queryStart = nowMs()
  const queryVectors = await embedBatch(
    model,
    queries.map((q) => q.text)
  )

  const perQuery = []
  let hitAt1 = 0
  let hitAtK = 0
  let top1CosineTotal = 0

  for (let qi = 0; qi < queries.length; qi += 1) {
    const query = queries[qi]
    const qVector = queryVectors[qi] || []

    const ranked = embeddedChunks
      .map((entry) => ({
        ...entry,
        similarity: cosine(qVector, entry.vector)
      }))
      .sort((a, b) => b.similarity - a.similarity)

    const top = ranked.slice(0, Math.max(1, TOP_K))
    const top1 = top[0]

    top1CosineTotal += Number(top1?.similarity || 0)

    const expected = (query.expectedAny || []).map((v) => String(v).toLowerCase())
    const hasMatch = (text) => {
      if (expected.length === 0) return false
      const lower = String(text || '').toLowerCase()
      return expected.some((token) => lower.includes(token))
    }

    const top1Matched = Boolean(top1 && hasMatch(top1.chunk.content))
    const topKMatched = top.some((item) => hasMatch(item.chunk.content))

    if (top1Matched) hitAt1 += 1
    if (topKMatched) hitAtK += 1

    perQuery.push({
      queryId: query.id,
      queryText: query.text,
      top1File: top1?.chunk.fileName || '-',
      top1Similarity: Number(top1?.similarity || 0),
      top1Matched,
      topKMatched,
      topK: top.map((item) => ({
        file: item.chunk.fileName,
        similarity: Number(item.similarity.toFixed(6)),
        preview: item.chunk.content.replace(/\s+/g, ' ').slice(0, 120)
      }))
    })
  }

  const queryMs = nowMs() - queryStart

  return {
    model,
    dimensions: embeddedChunks[0]?.vector?.length || 0,
    chunks: embeddedChunks.length,
    indexMs,
    queryMs,
    totalMs: indexMs + queryMs,
    hitAt1,
    hitAtK,
    queryCount: queries.length,
    avgTop1Similarity: queries.length > 0 ? top1CosineTotal / queries.length : 0,
    perQuery
  }
}

const printHeader = () => {
  console.log('\n=== SignalDesk Embedding Benchmark ===')
  console.log(`Ollama URL: ${OLLAMA_URL}`)
  console.log(`Source dir: ${SOURCE_DIR}`)
  console.log(`Top-K: ${TOP_K}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  if (MAX_CHUNKS > 0) {
    console.log(`Max chunks: ${MAX_CHUNKS}`)
  }
}

const formatPct = (value, total) => {
  if (!total) return '0.0%'
  return `${((100 * value) / total).toFixed(1)}%`
}

const main = async () => {
  printHeader()

  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`)
  }

  const files = collectFiles(SOURCE_DIR)
  if (files.length === 0) {
    throw new Error(`No supported files found in ${SOURCE_DIR}`)
  }

  const allChunks = files.flatMap((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    return toChunks(filePath, content)
  })

  const chunks = MAX_CHUNKS > 0 ? allChunks.slice(0, MAX_CHUNKS) : allChunks

  console.log(`Files found: ${files.length}`)
  console.log(`Chunks built: ${chunks.length}`)

  const queries = readQueries()
  console.log(`Queries: ${queries.length}`)

  const discoveredModels = await listOllamaModels()
  const discoveredNames = discoveredModels.map((m) => m.name)
  const selectedModels = MODELS_FILTER
    ? discoveredModels.filter((model) => MODELS_FILTER.has(model.name))
    : ALL_MODELS
      ? discoveredModels
      : discoveredModels.filter(isLikelyEmbeddingModel)

  if (selectedModels.length === 0) {
    throw new Error('No models selected. Use --models=model1,model2 or install models in Ollama.')
  }

  console.log(`\nModels discovered: ${discoveredModels.length}`)
  console.log(`Models selected: ${selectedModels.length}`)
  if (!MODELS_FILTER && !ALL_MODELS) {
    console.log('Selection mode: safe default (embedding-like models only). Use --allModels=1 to include all.')
  }
  if (!MODELS_FILTER && !ALL_MODELS) {
    const skipped = discoveredNames.filter((name) => !selectedModels.some((model) => model.name === name))
    if (skipped.length > 0) {
      console.log(`Skipped non-embedding candidates: ${skipped.join(', ')}`)
    }
  }

  const supported = []
  const unsupported = []

  for (const model of selectedModels) {
    process.stdout.write(`Probe embedding support: ${model.name} ... `)
    const probe = await supportsEmbedding(model.name)
    if (probe.ok) {
      supported.push({ model: model.name, dimensions: probe.dimensions })
      process.stdout.write(`ok (${probe.dimensions} dims)\n`)
    } else {
      unsupported.push({ model: model.name, error: probe.error || 'not supported' })
      process.stdout.write(`fail\n`)
    }
  }

  if (unsupported.length > 0) {
    console.log('\nUnsupported/failed models:')
    for (const item of unsupported) {
      console.log(`- ${item.model}: ${item.error}`)
    }
  }

  if (supported.length === 0) {
    throw new Error('No embedding-capable model available in selected set.')
  }

  const results = []

  for (const { model } of supported) {
    console.log(`\nRunning benchmark for ${model} ...`)
    const result = await evaluateModel(model, chunks, queries)
    results.push(result)

    console.log(
      `  done: index=${result.indexMs}ms, query=${result.queryMs}ms, hit@1=${result.hitAt1}/${result.queryCount}, hit@${TOP_K}=${result.hitAtK}/${result.queryCount}`
    )
  }

  results.sort((a, b) => {
    const scoreA = (a.hitAt1 / Math.max(1, a.queryCount)) * 0.6 + (a.hitAtK / Math.max(1, a.queryCount)) * 0.4
    const scoreB = (b.hitAt1 / Math.max(1, b.queryCount)) * 0.6 + (b.hitAtK / Math.max(1, b.queryCount)) * 0.4
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.totalMs - b.totalMs
  })

  console.log('\n=== Ranking ===')
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i]
    console.log(
      `${i + 1}. ${r.model} | dims=${r.dimensions} | hit@1=${r.hitAt1}/${r.queryCount} (${formatPct(r.hitAt1, r.queryCount)}) | hit@${TOP_K}=${r.hitAtK}/${r.queryCount} (${formatPct(r.hitAtK, r.queryCount)}) | avgTop1Cos=${r.avgTop1Similarity.toFixed(4)} | total=${r.totalMs}ms`
    )
  }

  const outPath = path.resolve(process.cwd(), 'embedding-benchmark-results.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        ollamaUrl: OLLAMA_URL,
        sourceDir: SOURCE_DIR,
        topK: TOP_K,
        batchSize: BATCH_SIZE,
        files: files.length,
        chunks: chunks.length,
        queries,
        unsupported,
        results
      },
      null,
      2
    )
  )

  console.log(`\nDetailed report written to: ${outPath}`)
}

main().catch((error) => {
  console.error(`\nBenchmark failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
