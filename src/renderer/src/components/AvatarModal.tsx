import {
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Save,
  X
} from 'lucide-react'
import { TextareaHTMLAttributes, useEffect, useRef, useState } from 'react'
import { AvatarProfile, useInterviewStore } from '../store/interviewStore'

const AVATAR_LIMITS = {
  identityBase: 2400,
  cvSummary: 700,
  jobTitle: 60,
  companyName: 30,
  jobDescription: 1600,
  companyContext: 250
} as const

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const clampField = (field: keyof typeof AVATAR_LIMITS, value: string): string =>
  normalizeText(value).slice(0, AVATAR_LIMITS[field])

const getLength = (value: string): number => normalizeText(value).length

const formatTimestamp = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : 'Not indexed yet'

const fieldLabelClassName = 'settings-field-label block'
const textareaClassName =
  'w-full overflow-hidden px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y'
const inputClassName =
  'w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:outline-none focus:border-blue-500'

function AutoResizeTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>
): React.ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = (): void => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(() => {
    resize()
  }, [props.value])

  return (
    <textarea
      {...props}
      ref={textareaRef}
      onInput={(event) => {
        resize()
        props.onInput?.(event)
      }}
    />
  )
}

function SectionDivider({ label }: { label: string }): React.ReactNode {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-cyan-400/20" />
      <span className="settings-field-label shrink-0 text-dark-500">{label}</span>
      <div className="h-px flex-1 bg-cyan-400/20" />
    </div>
  )
}

export function AvatarModal(): React.ReactNode | null {
  const {
    avatarProfile,
    avatarIndexStatus,
    avatarReindexProgress,
    showAvatar,
    setShowAvatar,
    setAvatarProfile,
    setAvatarIndexStatus,
    setAvatarReindexProgress
  } = useInterviewStore()
  const [localProfile, setLocalProfile] = useState<AvatarProfile>(avatarProfile)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [reindexStatus, setReindexStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false)
  const [embeddingModelsError, setEmbeddingModelsError] = useState<string | null>(null)
  const [embeddingTestStatus, setEmbeddingTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [embeddingTestMessage, setEmbeddingTestMessage] = useState('')

  useEffect(() => {
    setLocalProfile(avatarProfile)
  }, [avatarProfile, showAvatar])

  useEffect(() => {
    if (!showAvatar) return

    const loadStatus = async (): Promise<void> => {
      try {
        const status = await window.api.getAvatarIndexStatus()
        setAvatarIndexStatus(status)
      } catch (error) {
        console.error('Failed to load avatar index status:', error)
      }
    }

    loadStatus()
  }, [setAvatarIndexStatus, showAvatar])

  useEffect(() => {
    if (!showAvatar) return

    const loadEmbeddingModels = async (): Promise<void> => {
      setEmbeddingModelsLoading(true)
      setEmbeddingModelsError(null)
      try {
        const result = await window.api.fetchEmbeddingModels(localProfile.embeddingModelDir || undefined)
        if (!result.success) {
          throw new Error(result.error || 'Failed to load local embedding models.')
        }

        const uniqueModels = Array.from(
          new Set(
            result.models
              .map((model) => model.id.trim())
              .filter(Boolean)
              .concat(localProfile.embeddingModel ? [localProfile.embeddingModel] : [])
          )
        ).sort((left, right) => left.localeCompare(right))

        setEmbeddingModels(uniqueModels)

        const hasSelectedModel = localProfile.embeddingModel && 
          result.models.some(m => m.id === localProfile.embeddingModel)
        
        if (result.models.length === 0) {
          setEmbeddingModelsError('No models found')
          if (localProfile.embeddingModel || localProfile.embeddingModelDir) {
            setLocalProfile(prev => ({ ...prev, embeddingModel: '', embeddingModelDir: '' }))
          }
        } else if (localProfile.embeddingModel && !hasSelectedModel) {
          setLocalProfile(prev => ({ ...prev, embeddingModel: '' }))
        }
      } catch (error) {
        console.error('Failed to load local embedding models:', error)
        setEmbeddingModels(localProfile.embeddingModel ? [localProfile.embeddingModel] : [])
        setEmbeddingModelsError(
          error instanceof Error ? error.message : 'Failed to load local embedding models.'
        )
      } finally {
        setEmbeddingModelsLoading(false)
      }
    }

    loadEmbeddingModels()
  }, [showAvatar, localProfile.embeddingModel, localProfile.embeddingModelDir])

  if (!showAvatar) return null

  const handleClose = (): void => {
    setLocalProfile(avatarProfile)
    setShowAvatar(false)
    setSaveStatus('idle')
    setReindexStatus('idle')
    setAvatarReindexProgress(null)
    setStatusMessage('')
  }

  const handleSave = async (): Promise<void> => {
    try {
      setSaveStatus('saving')
      const nextProfile = await window.api.updateAvatarProfile(localProfile)
      setAvatarProfile(nextProfile)
      setSaveStatus('saved')
      setTimeout(() => {
        setSaveStatus('idle')
      }, 900)
    } catch (error) {
      console.error('Failed to save avatar profile:', error)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 2500)
    }
  }

  const handleOpenMemoryFolder = async (): Promise<void> => {
    try {
      const result = await window.api.openAvatarMemoryFolder()
      if (!result.success) {
        setStatusMessage(result.error || 'Failed to open avatar memory folder.')
        setReindexStatus('error')
        setTimeout(() => setReindexStatus('idle'), 3000)
      }
    } catch (error) {
      console.error('Failed to open avatar memory folder:', error)
      setStatusMessage(error instanceof Error ? error.message : 'Failed to open memory folder.')
      setReindexStatus('error')
      setTimeout(() => setReindexStatus('idle'), 3000)
    }
  }

  const handleReindex = async (): Promise<void> => {
    try {
      setReindexStatus('running')
      setStatusMessage(`Rebuilding index with ${localProfile.embeddingModel}...`)
      setAvatarReindexProgress({
        totalDocuments: 0,
        processedDocuments: 0,
        embeddedChunks: 0,
        embeddingModel: localProfile.embeddingModel,
        currentFile: null
      })

      const savedProfile = await window.api.updateAvatarProfile(localProfile)
      setAvatarProfile(savedProfile)
      const status = await window.api.reindexAvatarSources()
      setAvatarIndexStatus(status)
      setAvatarReindexProgress(null)

      setReindexStatus('done')
      setStatusMessage(`Indexed ${status.documentCount} documents and ${status.chunkCount} chunks.`)
      setTimeout(() => setReindexStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to reindex avatar sources:', error)
      setReindexStatus('error')
      setAvatarReindexProgress(null)
      setStatusMessage(error instanceof Error ? error.message : 'Avatar reindex failed.')
      setTimeout(() => setReindexStatus('idle'), 3000)
    }
  }

  const handleTestEmbedding = async (): Promise<void> => {
    try {
      setEmbeddingTestStatus('testing')
      setEmbeddingTestMessage('')
      const result = await window.api.testEmbeddingModel(
        localProfile.embeddingModel,
        localProfile.embeddingModelDir || undefined
      )
      if (result.valid) {
        setEmbeddingTestStatus('ok')
        setEmbeddingTestMessage('Embedding model validated successfully')
      } else {
        setEmbeddingTestStatus('error')
        setEmbeddingTestMessage(result.error || 'Validation failed')
      }
    } catch (error) {
      setEmbeddingTestStatus('error')
      setEmbeddingTestMessage(error instanceof Error ? error.message : 'Test failed')
    }
    setTimeout(() => setEmbeddingTestStatus('idle'), 3000)
  }

  const status = avatarIndexStatus
  const isReindexing = reindexStatus === 'running'
  const visibleDocumentCount = isReindexing
    ? avatarReindexProgress?.processedDocuments ?? 0
    : status?.documentCount ?? 0
  const visibleChunkCount = isReindexing
    ? avatarReindexProgress?.embeddedChunks ?? 0
    : status?.chunkCount ?? 0
  const reindexDetail =
    isReindexing && avatarReindexProgress
      ? `${avatarReindexProgress.processedDocuments}/${avatarReindexProgress.totalDocuments || 0} documents, ${avatarReindexProgress.embeddedChunks} chunks`
      : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="settings-modal mx-4 w-full max-w-lg overflow-hidden rounded-[14px] bg-[rgba(7,16,24,0.97)] shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3.5">
          <h2 className="settings-modal-title">Avatar</h2>
          <button
            onClick={handleClose}
            className="rounded-lg border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-stack custom-scrollbar max-h-[32rem] space-y-5 overflow-y-auto px-6 py-4">
          <section className="space-y-4">
            <div className="space-y-2 pb-1">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>Identity Base</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.identityBase)}/{AVATAR_LIMITS.identityBase}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.identityBase}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    identityBase: clampField('identityBase', e.target.value)
                  })
                }
                rows={7}
                maxLength={AVATAR_LIMITS.identityBase}
                placeholder="How you work, your real strengths, and your factual limits."
                className={textareaClassName}
              />
            </div>

            <SectionDivider label="Interview Context" />

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>CV Summary</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.cvSummary)}/{AVATAR_LIMITS.cvSummary}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.cvSummary}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    cvSummary: clampField('cvSummary', e.target.value)
                  })
                }
                rows={5}
                maxLength={AVATAR_LIMITS.cvSummary}
                placeholder="Summarize your background, strengths, and relevant experience..."
                className={textareaClassName}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className={fieldLabelClassName}>Role / Position</label>
                  <span className="text-xs text-dark-400">
                    {getLength(localProfile.jobTitle)}/{AVATAR_LIMITS.jobTitle}
                  </span>
                </div>
                <input
                  type="text"
                  value={localProfile.jobTitle}
                  onChange={(e) =>
                    setLocalProfile({
                      ...localProfile,
                      jobTitle: clampField('jobTitle', e.target.value)
                    })
                  }
                  maxLength={AVATAR_LIMITS.jobTitle}
                  placeholder="e.g. Senior Backend Engineer"
                  className={inputClassName}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className={fieldLabelClassName}>Company</label>
                  <span className="text-xs text-dark-400">
                    {getLength(localProfile.companyName)}/{AVATAR_LIMITS.companyName}
                  </span>
                </div>
                <input
                  type="text"
                  value={localProfile.companyName}
                  onChange={(e) =>
                    setLocalProfile({
                      ...localProfile,
                      companyName: clampField('companyName', e.target.value)
                    })
                  }
                  maxLength={AVATAR_LIMITS.companyName}
                  placeholder="Company name"
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>Job Description</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.jobDescription)}/{AVATAR_LIMITS.jobDescription}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.jobDescription}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    jobDescription: clampField('jobDescription', e.target.value)
                  })
                }
                rows={6}
                maxLength={AVATAR_LIMITS.jobDescription}
                placeholder="Paste the job description or the main requirements..."
                className={textareaClassName}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>Company Details</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.companyContext)}/{AVATAR_LIMITS.companyContext}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.companyContext}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    companyContext: clampField('companyContext', e.target.value)
                  })
                }
                rows={5}
                maxLength={AVATAR_LIMITS.companyContext}
                placeholder="Add product, market, team, stack, culture, or other company details..."
                className={textareaClassName}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionDivider label="Retrievable Memory" />

            <div className="space-y-2">
              <label className={fieldLabelClassName}>Memory Sources</label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={handleOpenMemoryFolder}
                  className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.04] px-3 py-2 text-sm text-dark-200 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8"
                >
                  <FolderOpen size={16} />
                  <span>Open Folder</span>
                </button>
              </div>
              <p className="text-xs text-dark-500">
                Add your markdown notes to this folder, then click Reindex.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className={fieldLabelClassName}>Embedding Model</label>
                <select
                  value={localProfile.embeddingModel}
                  onChange={(e) =>
                    setLocalProfile({
                      ...localProfile,
                      embeddingModel: e.target.value
                    })
                  }
                  className={inputClassName}
                >
                  {(embeddingModels.length > 0
                    ? embeddingModels
                    : localProfile.embeddingModel
                    ? [localProfile.embeddingModel]
                    : []
                  ).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                {embeddingModelsLoading && (
                  <p className="text-xs text-dark-500">Loading local embedding models...</p>
                )}
                {embeddingModelsError && (
                  <p className="text-xs text-dark-400">{embeddingModelsError}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className={fieldLabelClassName}>Model Directory</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={localProfile.embeddingModelDir || 'Default'}
                    className={inputClassName}
                    placeholder="Default"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await window.api.selectEmbeddingModelDir()
                      if (result.success && result.directory) {
                        setLocalProfile({ ...localProfile, embeddingModelDir: result.directory })
                      }
                    }}
                    className="flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.04] px-3 py-2 text-sm font-medium text-dark-200 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-100"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className={fieldLabelClassName}>Last Indexed</label>
                <input
                  type="text"
                  readOnly
                  value={isReindexing ? 'Reindexing...' : formatTimestamp(status?.lastIndexedAt ?? null)}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabelClassName}>Documents</label>
                <input
                  type="text"
                  readOnly
                  value={String(visibleDocumentCount)}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabelClassName}>Chunks</label>
                <input
                  type="text"
                  readOnly
                  value={String(visibleChunkCount)}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTestEmbedding}
                disabled={embeddingTestStatus === 'testing'}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/[0.04] px-4 py-2 text-sm font-medium text-dark-200 transition-colors hover:border-green-400/15 hover:bg-green-400/8 hover:text-dark-100 disabled:opacity-60"
              >
                {embeddingTestStatus === 'testing' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    <span>Test</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReindex}
                disabled={isReindexing}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/[0.04] px-4 py-2 text-sm font-medium text-dark-200 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-100 disabled:opacity-60"
              >
                {isReindexing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Reindexing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    <span>Reindex</span>
                  </>
                )}
              </button>
            </div>

            {embeddingTestStatus === 'ok' && embeddingTestMessage && (
              <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                <CheckCircle size={12} />
                <span>{embeddingTestMessage}</span>
              </div>
            )}
            {embeddingTestStatus === 'error' && embeddingTestMessage && (
              <div className="settings-status-error flex items-center gap-1.5 text-xs">
                <AlertCircle size={12} />
                <span>{embeddingTestMessage}</span>
              </div>
            )}

            {status?.lastError && (
              <div className="settings-status-error flex items-center gap-1.5 text-xs">
                <AlertCircle size={12} />
                <span>{status.lastError}</span>
              </div>
            )}
            {reindexDetail && (
              <div className="flex items-center gap-1.5 text-xs text-dark-400">
                <Loader2 size={12} className="animate-spin" />
                <span>{reindexDetail}</span>
              </div>
            )}
            {statusMessage && reindexStatus === 'done' && (
              <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                <CheckCircle size={12} />
                <span>{statusMessage}</span>
              </div>
            )}
            {statusMessage && reindexStatus === 'error' && (
              <div className="settings-status-error flex items-center gap-1.5 text-xs">
                <AlertCircle size={12} />
                <span>{statusMessage}</span>
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3.5">
          <div className="flex items-center gap-3">
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle size={16} />
                <span>Failed to save</span>
              </div>
            )}
            {saveStatus === 'saved' && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle size={16} />
                <span>Saved!</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-gradient-to-r from-cyan-400 to-teal-400 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:from-cyan-300 hover:to-teal-300 disabled:opacity-50"
            >
              <Save size={16} />
              <span>{saveStatus === 'saving' ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
