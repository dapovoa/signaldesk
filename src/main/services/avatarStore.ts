import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import { AvatarRetrievedSnippet, IngestedChunk } from './avatarTypes'

interface DocumentUpsertResult {
  documentId: number
  changed: boolean
}

const VECTOR_TABLE = 'chunk_embeddings_vec'
const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const AVATAR_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_AVATAR_VERBOSE === '1'

const toJson = (value: unknown): string => JSON.stringify(value)
const resolveLoadableExtensionPath = (loadablePath: string): string => {
  const unpackedPath = loadablePath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)

  if (unpackedPath !== loadablePath && fs.existsSync(unpackedPath)) {
    return unpackedPath
  }

  return loadablePath
}

const toSqliteInteger = (value: number): bigint => {
  const normalized = Number(value)

  if (!Number.isFinite(normalized) || !Number.isInteger(normalized)) {
    throw new Error(`Invalid sqlite integer value: ${value}`)
  }

  return BigInt(normalized)
}

export class AvatarStore {
  private db: import('better-sqlite3').Database

  constructor(private readonly databasePath: string) {
    const require = createRequire(import.meta.url)
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')
    const sqliteVec = require('sqlite-vec') as typeof import('sqlite-vec')

    fs.mkdirSync(path.dirname(databasePath), { recursive: true })

    this.db = new BetterSqlite3(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.loadExtension(resolveLoadableExtensionPath(sqliteVec.getLoadablePath()))

    this.createBaseSchema()
  }

  close(): void {
    this.db.close()
  }

  getDatabasePath(): string {
    return this.databasePath
  }

  upsertDocument(params: {
    profileId: string
    sourcePath: string
    title: string
    sourceType: string
    content: string
    checksum: string
  }): DocumentUpsertResult {
    const now = new Date().toISOString()
    const existing = this.db
      .prepare(
        `SELECT id, checksum
         FROM documents
         WHERE profile_id = ? AND source_path = ?`
      )
      .get(params.profileId, params.sourcePath) as { id: number; checksum: string } | undefined

    if (existing && existing.checksum === params.checksum) {
      this.db
        .prepare(
          `UPDATE documents
           SET last_ingested_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, existing.id)

      return { documentId: existing.id, changed: false }
    }

    if (existing) {
      this.clearDocumentChunks(existing.id)
      this.db
        .prepare(
          `UPDATE documents
           SET title = ?, source_type = ?, content = ?, checksum = ?, updated_at = ?, last_ingested_at = ?
           WHERE id = ?`
        )
        .run(
          params.title,
          params.sourceType,
          params.content,
          params.checksum,
          now,
          now,
          existing.id
        )

      return { documentId: existing.id, changed: true }
    }

    const result = this.db
      .prepare(
        `INSERT INTO documents (
          profile_id,
          source_path,
          title,
          source_type,
          content,
          checksum,
          created_at,
          updated_at,
          last_ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.profileId,
        params.sourcePath,
        params.title,
        params.sourceType,
        params.content,
        params.checksum,
        now,
        now,
        now
      )

    return { documentId: Number(result.lastInsertRowid), changed: true }
  }

  replaceDocumentChunks(documentId: number, chunks: IngestedChunk[]): number[] {
    this.clearDocumentChunks(documentId)

    const insert = this.db.prepare(
      `INSERT INTO chunks (
        document_id,
        chunk_index,
        content,
        summary,
        kind,
        importance,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const now = new Date().toISOString()
    const ids: number[] = []

    const transaction = this.db.transaction(() => {
      chunks.forEach((chunk, index) => {
        const result = insert.run(
          documentId,
          index,
          chunk.content,
          chunk.summary,
          chunk.kind,
          chunk.importance,
          toJson(chunk.metadata ?? {}),
          now,
          now
        )
        ids.push(Number(result.lastInsertRowid))
      })
    })

    transaction()
    return ids
  }

  setEmbeddingConfig(model: string, dimensions: number): void {
    const currentModel = this.getMetadata('embedding_model')
    const currentDimensions = Number(this.getMetadata('embedding_dimensions') || '0')
    const tableExists = this.hasVectorTable()

    if (tableExists && currentModel === model && currentDimensions === dimensions) {
      if (AVATAR_VERBOSE_LOGS) {
        console.log('[AvatarStore] keeping existing vector table:', {
          model,
          dimensions
        })
      }
      return
    }

    console.log('[AvatarStore] rebuilding vector table:', {
      previousModel: currentModel || null,
      previousDimensions: currentDimensions || null,
      nextModel: model,
      nextDimensions: dimensions,
      hadExistingTable: tableExists
    })

    this.db.exec(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`)
    this.db.exec(
      `CREATE VIRTUAL TABLE ${VECTOR_TABLE} USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimensions}]
      )`
    )

    this.setMetadata('embedding_model', model)
    this.setMetadata('embedding_dimensions', String(dimensions))
  }

  replaceEmbeddings(chunkEmbeddings: Array<{ chunkId: number; embedding: number[] }>): void {
    if (!this.hasVectorTable() || chunkEmbeddings.length === 0) {
      if (AVATAR_VERBOSE_LOGS) {
        console.log('[AvatarStore] skipping embedding write:', {
          hasVectorTable: this.hasVectorTable(),
          embeddingCount: chunkEmbeddings.length
        })
      }
      return
    }

    if (AVATAR_VERBOSE_LOGS) {
      console.log('[AvatarStore] writing embeddings:', {
        embeddingCount: chunkEmbeddings.length
      })
    }

    const remove = this.db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`)
    const insert = this.db.prepare(
      `INSERT INTO ${VECTOR_TABLE} (chunk_id, embedding) VALUES (?, ?)`
    )

    const transaction = this.db.transaction(() => {
      for (const row of chunkEmbeddings) {
        const chunkId = toSqliteInteger(row.chunkId)
        remove.run(chunkId)
        insert.run(chunkId, toJson(row.embedding))
      }
    })

    transaction()
  }

  searchSimilar(questionEmbedding: number[], limit: number): AvatarRetrievedSnippet[] {
    if (!this.hasVectorTable()) {
      return []
    }

    const query = `
      SELECT
        c.id AS chunkId,
        c.document_id AS documentId,
        d.title AS title,
        d.source_type AS sourceType,
        c.kind AS kind,
        json_extract(c.metadata_json, '$.sectionTitle') AS sectionTitle,
        json_extract(c.metadata_json, '$.tags') AS tagsJson,
        json_extract(c.metadata_json, '$.headings') AS headingsJson,
        json_extract(c.metadata_json, '$.structureScore') AS structureScore,
        c.content AS content,
        c.summary AS summary,
        c.importance AS importance,
        matches.distance AS distance
      FROM (
        SELECT chunk_id, distance
        FROM ${VECTOR_TABLE}
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      ) AS matches
      JOIN chunks c ON c.id = matches.chunk_id
      JOIN documents d ON d.id = c.document_id
      ORDER BY matches.distance ASC, c.importance DESC
    `

    const rows = this.db.prepare(query).all(toJson(questionEmbedding), limit) as Array<
      AvatarRetrievedSnippet & {
        tagsJson?: string | null
        headingsJson?: string | null
        structureScore?: number | null
      }
    >

    return rows.map((row) => ({
      ...row,
      sectionTitle: row.sectionTitle || row.title,
      tags: row.tagsJson ? ((JSON.parse(row.tagsJson) as string[]) || []) : [],
      headings: row.headingsJson ? ((JSON.parse(row.headingsJson) as string[]) || []) : [],
      structureScore: Number(row.structureScore || 0)
    }))
  }

  getMetadata(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM app_metadata WHERE key = ?`)
      .get(key) as { value: string } | undefined
    return row?.value
  }

  getStats(): { documentCount: number; chunkCount: number; lastIndexedAt: number | null } {
    const docs = this.db
      .prepare(`SELECT COUNT(*) AS total, MAX(last_ingested_at) AS lastIndexedAt FROM documents`)
      .get() as { total: number; lastIndexedAt: string | null }
    const chunks = this.db.prepare(`SELECT COUNT(*) AS total FROM chunks`).get() as { total: number }

    return {
      documentCount: docs.total || 0,
      chunkCount: chunks.total || 0,
      lastIndexedAt: docs.lastIndexedAt ? new Date(docs.lastIndexedAt).getTime() : null
    }
  }

  resetIndex(profileId = 'default'): void {
    const tableExists = this.hasVectorTable()
    const previousModel = this.getMetadata('embedding_model') || null
    const previousDimensions = Number(this.getMetadata('embedding_dimensions') || '0') || null

    console.log('[AvatarStore] nuking avatar index:', {
      profileId,
      hadExistingTable: tableExists,
      previousModel,
      previousDimensions
    })

    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM chunks`).run()
      this.db.prepare(`DELETE FROM documents WHERE profile_id = ?`).run(profileId)
      this.db.prepare(`DELETE FROM app_metadata WHERE key IN ('embedding_model', 'embedding_dimensions')`).run()
      this.db.exec(`DROP TABLE IF EXISTS ${VECTOR_TABLE}`)
    })

    transaction()
  }

  private setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_metadata (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  private clearDocumentChunks(documentId: number): void {
    const rows = this.db
      .prepare(`SELECT id FROM chunks WHERE document_id = ?`)
      .all(documentId) as Array<{ id: number }>

    if (rows.length > 0 && this.hasVectorTable()) {
      const remove = this.db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE chunk_id = ?`)
      const removeTransaction = this.db.transaction((ids: number[]) => {
        ids.forEach((id) => remove.run(toSqliteInteger(id)))
      })
      removeTransaction(rows.map((row) => row.id))
    }

    this.db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId)
  }

  private hasVectorTable(): boolean {
    const row = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = ?`
      )
      .get(VECTOR_TABLE) as { name: string } | undefined

    return Boolean(row?.name)
  }

  private createBaseSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS avatar_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        voice_profile_json TEXT NOT NULL,
        answer_policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_ingested_at TEXT NOT NULL,
        UNIQUE(profile_id, source_path)
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        kind TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_documents_profile_id ON documents(profile_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_kind ON chunks(kind);
    `)

    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO avatar_profiles (id, name, voice_profile_json, answer_policy_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(
        'default',
        'Default Interview Avatar',
        toJson({
          traits: ['direct', 'calm', 'professional', 'simple', 'factual', 'pragmatic'],
          preferredStarters: ['primeiro', 'depende', 'normalmente', 'basicamente'],
          bannedExpressions: ['great question', 'ensure', 'best practices', 'robust solution', 'caras']
        }),
        toJson({
          brevity: 'short-by-default',
          uncertainty: 'analyze-first',
          structure: ['first practical move', 'brief validation', 'stop early']
        }),
        now,
        now
      )
  }
}
