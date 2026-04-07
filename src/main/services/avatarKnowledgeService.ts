import * as path from 'path'
import { AvatarIngestionService } from './avatarIngestion'
import { LlamaCppEmbeddingProvider } from './avatarEmbeddingProvider'
import { llamaCppServer } from './llamaCppServer'
import {
  AvatarIndexStatus,
  AvatarProfile,
  getDefaultAvatarRoot,
  getDefaultAvatarSourceDirectory
} from './avatarProfileManager'
import { AvatarRetrievalService } from './avatarRetrieval'
import { AvatarStore } from './avatarStore'
import { AvatarContextPack } from './avatarTypes'

const REFRESH_INTERVAL_MS = 60_000
const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const AVATAR_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_AVATAR_VERBOSE === '1'

export class AvatarKnowledgeService {
  private store: AvatarStore | null
  private ingestion: AvatarIngestionService | null
  private retrieval: AvatarRetrievalService | null
  private initPromise: Promise<void> | null = null
  private refreshPromise: Promise<void> | null = null
  private lastRefreshAt = 0
  private readonly databasePath: string
  private lastError: string | null = null

  constructor(profile: AvatarProfile) {
    const avatarRoot = getDefaultAvatarRoot()
    this.databasePath = path.join(avatarRoot, 'avatar.sqlite')
    this.store = null
    this.ingestion = null
    this.retrieval = null

    this.configureServices(profile)
  }

  private configureServices(profile: AvatarProfile): void {
    try {
      const sourceDirectory = profile.sourceDirectory || getDefaultAvatarSourceDirectory()
      const embeddingProvider = new LlamaCppEmbeddingProvider({
        model: profile.embeddingModel
      })

      this.store = new AvatarStore(this.databasePath)
      this.ingestion = new AvatarIngestionService(this.store, embeddingProvider, sourceDirectory)
      this.retrieval = new AvatarRetrievalService(this.store, embeddingProvider)
    } catch (error) {
      console.warn('[AvatarKnowledge] local RAG disabled during startup:', error)
      this.store = null
      this.ingestion = null
      this.retrieval = null
      this.lastError = error instanceof Error ? error.message : 'Unknown avatar startup error'
    }
  }

  async initialize(): Promise<void> {
    if (!this.ingestion) {
      return
    }

    if (!this.initPromise) {
      this.initPromise = this.ingestion
        .syncSourceDirectory()
        .then(() => {
          this.lastRefreshAt = Date.now()
          this.lastError = null
        })
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : 'Avatar sync failed'
          throw error
        })
    }

    return this.initPromise
  }

  updateProfile(profile: AvatarProfile, options?: { silentLog?: boolean }): void {
    if (AVATAR_VERBOSE_LOGS && !options?.silentLog) {
      console.log('[AvatarKnowledge] updating profile for RAG:', {
        embeddingModel: profile.embeddingModel,
        sourceDirectory: profile.sourceDirectory
      })
    }
    this.dispose()
    this.configureServices(profile)
    this.lastRefreshAt = 0
    this.initPromise = null
  }

  async reindex(
    profile: AvatarProfile,
    onProgress?: (progress: {
      totalDocuments: number
      processedDocuments: number
      embeddedChunks: number
      embeddingModel: string
      currentFile: string | null
    }) => void
  ): Promise<AvatarIndexStatus> {
    const startedAt = Date.now()
    if (AVATAR_VERBOSE_LOGS) {
      console.log('[AvatarKnowledge] reindex requested:', {
        embeddingModel: profile.embeddingModel,
        sourceDirectory: profile.sourceDirectory
      })
    }
    this.updateProfile(profile, { silentLog: true })

    if (this.ingestion) {
      this.store?.resetIndex()
      onProgress?.({
        totalDocuments: 0,
        processedDocuments: 0,
        embeddedChunks: 0,
        embeddingModel: profile.embeddingModel,
        currentFile: null
      })
      await this.ingestion.syncSourceDirectory(onProgress)
      this.lastRefreshAt = Date.now()
      this.lastError = null
      const status = this.getStatus(profile)
      const durationMs = Date.now() - startedAt
      if (AVATAR_VERBOSE_LOGS) {
        console.log('[AvatarKnowledge] reindex completed:', {
          embeddingModel: profile.embeddingModel,
          documentCount: status.documentCount,
          chunkCount: status.chunkCount,
          durationMs
        })
        console.log(
          `[AvatarKnowledge] summary: reindex finished in ${durationMs}ms, documents=${status.documentCount}, chunks=${status.chunkCount}, model=${profile.embeddingModel}`
        )
      }
      return status
    }

    return this.getStatus(profile)
  }

  getStatus(profile: AvatarProfile): AvatarIndexStatus {
    const stats = this.store?.getStats() || {
      documentCount: 0,
      chunkCount: 0,
      lastIndexedAt: null
    }

    return {
      available: Boolean(this.store && this.ingestion && this.retrieval),
      sourceDirectory: profile.sourceDirectory,
      embeddingModel: profile.embeddingModel,
      documentCount: stats.documentCount,
      chunkCount: stats.chunkCount,
      lastIndexedAt: stats.lastIndexedAt,
      databasePath: this.databasePath,
      lastError: this.lastError
    }
  }

  async buildContextPack(question: string): Promise<AvatarContextPack | null> {
    if (!this.retrieval || !this.ingestion) {
      return null
    }

    await this.initialize()

    if (Date.now() - this.lastRefreshAt >= REFRESH_INTERVAL_MS && !this.refreshPromise) {
      this.refreshPromise = this.ingestion
        .syncSourceDirectory()
        .then(() => {
          this.lastRefreshAt = Date.now()
          this.lastError = null
        })
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : 'Avatar sync failed'
          if (AVATAR_VERBOSE_LOGS) {
            console.warn('[AvatarKnowledge] periodic source sync failed:', error)
          }
        })
        .finally(() => {
          this.refreshPromise = null
        })
    }

    return this.retrieval.buildContextPack(question)
  }

  dispose(): void {
    this.store?.close()
    void llamaCppServer.dispose()
  }
}
