import { AlertCircle, CheckCircle, Save, X } from 'lucide-react'
import { TextareaHTMLAttributes, useEffect, useRef, useState } from 'react'
import { AvatarProfile, useInterviewStore } from '../store/interviewStore'

const AVATAR_LIMITS = {
  identityBase: 2400,
  answerStyle: 700,
  jobTitle: 60,
  companyName: 30,
  jobDescription: 1600,
  companyContext: 250,
  candidateKnowledge: 50000
} as const

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const clampField = (field: keyof typeof AVATAR_LIMITS, value: string): string =>
  normalizeText(value).slice(0, AVATAR_LIMITS[field])

const getLength = (value: string): number => normalizeText(value).length

const fieldLabelClassName = 'settings-field-label block'
const textareaClassName =
  'w-full overflow-hidden px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y'
const inputClassName =
  'w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:outline-none focus:border-blue-500'

function AutoResizeTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactNode {
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
  const { avatarProfile, showAvatar, setShowAvatar, setAvatarProfile } = useInterviewStore()
  const [localProfile, setLocalProfile] = useState<AvatarProfile>(avatarProfile)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    setLocalProfile(avatarProfile)
  }, [avatarProfile, showAvatar])

  if (!showAvatar) return null

  const handleClose = (): void => {
    setLocalProfile(avatarProfile)
    setShowAvatar(false)
    setSaveStatus('idle')
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

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>Answer Style</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.answerStyle)}/{AVATAR_LIMITS.answerStyle}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.answerStyle}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    answerStyle: clampField('answerStyle', e.target.value)
                  })
                }
                rows={4}
                maxLength={AVATAR_LIMITS.answerStyle}
                placeholder="How the answer should sound out loud: short sentences, natural wording, calm and direct tone."
                className={textareaClassName}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className={fieldLabelClassName}>Candidate Knowledge</label>
                <span className="text-xs text-dark-400">
                  {getLength(localProfile.candidateKnowledge)}/{AVATAR_LIMITS.candidateKnowledge}
                </span>
              </div>
              <AutoResizeTextarea
                value={localProfile.candidateKnowledge}
                onChange={(e) =>
                  setLocalProfile({
                    ...localProfile,
                    candidateKnowledge: clampField('candidateKnowledge', e.target.value)
                  })
                }
                rows={10}
                maxLength={AVATAR_LIMITS.candidateKnowledge}
                placeholder="Paste your full knowledge base here. This is your factual memory - experiences, projects, skills, background."
                className={textareaClassName}
              />
            </div>

            <SectionDivider label="Interview Context" />

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
