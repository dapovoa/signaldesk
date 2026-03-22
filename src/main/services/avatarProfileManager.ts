import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface AvatarProfile {
  id: string
  identityBase: string
  cvSummary: string
  jobTitle: string
  companyName: string
  jobDescription: string
  companyContext: string
  sourceDirectory: string
  embeddingModel: string
  updatedAt: number
}

export interface AvatarIndexStatus {
  available: boolean
  sourceDirectory: string
  embeddingModel: string
  documentCount: number
  chunkCount: number
  lastIndexedAt: number | null
  databasePath: string
  lastError: string | null
}

export const getDefaultAvatarRoot = (): string => path.join(app.getPath('userData'), 'avatar')

export const getDefaultAvatarSourceDirectory = (): string =>
  path.join(getDefaultAvatarRoot(), 'sources')

const getLegacySettingsPath = (): string => path.join(app.getPath('userData'), 'settings.json')
const LEGACY_PROFILE_SETTING_KEYS = [
  'identityBase',
  'cvSummary',
  'jobTitle',
  'companyName',
  'jobDescription',
  'companyContext',
  'resumeDescription'
] as const

const AVATAR_LIMITS = {
  identityBase: 2400,
  cvSummary: 700,
  jobTitle: 60,
  companyName: 30,
  jobDescription: 1600,
  companyContext: 250
} as const

const DEFAULT_IDENTITY_BASE = `Sou um engenheiro direto, calmo e pragmático. Normalmente começo pelo ponto mais concreto do problema e sigo por análise, validação e exclusão até perceber o que interessa. Prefiro respostas curtas, factuais e simples, sem buzzwords, sem tom professoral e sem linguagem corporativa.

Em termos técnicos, valorizo simplicidade, legibilidade, automação, boa formatação de código e logs claros. Quando estou a implementar, começo pelo caminho mais simples que me dê sinal rápido, depois ajusto até ficar estável e robusto. Dou muita importância a prioridade, observabilidade e controlo de complexidade.

Se não souber algo ao certo, digo isso de forma simples e analiso primeiro. Não invento experiência nem ferramentas que não usei. Quando discordo, apresento factos. Quando respondo bem, sou simples, direto e orientado ao primeiro passo útil.`

const normalizeText = (value: string | undefined): string =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''

const clampText = (value: string | undefined, maxLength: number): string =>
  normalizeText(value).slice(0, maxLength)

const pickFirstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const normalized = normalizeText(value).trim()
    if (normalized) return normalized
  }

  return ''
}

const pickIdentityBase = (
  profileIdentityBase: string | undefined,
  legacyIdentityBase: string | undefined
): string => {
  const normalizedProfileIdentityBase = normalizeText(profileIdentityBase).trim()
  const normalizedDefaultIdentityBase = normalizeText(DEFAULT_IDENTITY_BASE).trim()

  return pickFirstNonEmpty(
    normalizedProfileIdentityBase &&
      normalizedProfileIdentityBase !== normalizedDefaultIdentityBase
      ? profileIdentityBase
      : '',
    legacyIdentityBase,
    DEFAULT_IDENTITY_BASE
  )
}

const buildDefaultProfile = (): AvatarProfile => {
  return {
    id: 'default',
    identityBase: DEFAULT_IDENTITY_BASE,
    cvSummary: '',
    jobTitle: '',
    companyName: '',
    jobDescription: '',
    companyContext: '',
    sourceDirectory: getDefaultAvatarSourceDirectory(),
    embeddingModel: process.env.SIGNALDESK_EMBED_MODEL || 'mxbai-embed-large',
    updatedAt: Date.now()
  }
}

const normalizeProfile = (profile: AvatarProfile): AvatarProfile => ({
  ...profile,
  identityBase: clampText(profile.identityBase, AVATAR_LIMITS.identityBase),
  cvSummary: clampText(profile.cvSummary, AVATAR_LIMITS.cvSummary),
  jobTitle: clampText(profile.jobTitle, AVATAR_LIMITS.jobTitle),
  companyName: clampText(profile.companyName, AVATAR_LIMITS.companyName),
  jobDescription: clampText(profile.jobDescription, AVATAR_LIMITS.jobDescription),
  companyContext: clampText(profile.companyContext, AVATAR_LIMITS.companyContext),
  sourceDirectory: getDefaultAvatarSourceDirectory(),
  embeddingModel: profile.embeddingModel?.trim() || buildDefaultProfile().embeddingModel,
  updatedAt: profile.updatedAt || Date.now()
})

const loadLegacyProfileFields = (): {
  fields: Partial<AvatarProfile>
  hasLegacyKeys: boolean
} => {
  try {
    const legacySettingsPath = getLegacySettingsPath()
    if (!fs.existsSync(legacySettingsPath)) {
      return { fields: {}, hasLegacyKeys: false }
    }

    const raw = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf-8')) as Record<string, unknown>
    return {
      fields: {
        identityBase: typeof raw.identityBase === 'string' ? raw.identityBase : undefined,
        cvSummary:
          typeof raw.cvSummary === 'string'
            ? raw.cvSummary
            : typeof raw.resumeDescription === 'string'
              ? raw.resumeDescription
              : undefined,
        jobTitle: typeof raw.jobTitle === 'string' ? raw.jobTitle : undefined,
        companyName: typeof raw.companyName === 'string' ? raw.companyName : undefined,
        jobDescription: typeof raw.jobDescription === 'string' ? raw.jobDescription : undefined,
        companyContext: typeof raw.companyContext === 'string' ? raw.companyContext : undefined
      },
      hasLegacyKeys: LEGACY_PROFILE_SETTING_KEYS.some((key) => key in raw)
    }
  } catch (error) {
    console.warn('Failed to load legacy avatar fields from settings:', error)
    return { fields: {}, hasLegacyKeys: false }
  }
}

const mergeLegacyProfileFields = (
  profile: AvatarProfile
): { profile: AvatarProfile; hasLegacyKeys: boolean } => {
  const legacy = loadLegacyProfileFields()

  return {
    profile: {
      ...profile,
      identityBase: pickIdentityBase(profile.identityBase, legacy.fields.identityBase),
      cvSummary: pickFirstNonEmpty(profile.cvSummary, legacy.fields.cvSummary),
      jobTitle: pickFirstNonEmpty(profile.jobTitle, legacy.fields.jobTitle),
      companyName: pickFirstNonEmpty(profile.companyName, legacy.fields.companyName),
      jobDescription: pickFirstNonEmpty(profile.jobDescription, legacy.fields.jobDescription),
      companyContext: pickFirstNonEmpty(profile.companyContext, legacy.fields.companyContext)
    },
    hasLegacyKeys: legacy.hasLegacyKeys
  }
}

export class AvatarProfileManager {
  private readonly profilePath: string
  private profile: AvatarProfile

  constructor() {
    const avatarRoot = getDefaultAvatarRoot()
    this.profilePath = path.join(avatarRoot, 'profile.json')
    const loaded = this.loadProfile()
    this.profile = loaded.profile

    if (loaded.needsSave) {
      this.saveProfile()
    }

    if (loaded.shouldClearLegacySettings) {
      this.clearLegacyProfileFieldsFromSettings()
    }
  }

  getAvatarRoot(): string {
    return path.dirname(this.profilePath)
  }

  getProfilePath(): string {
    return this.profilePath
  }

  getProfile(): AvatarProfile {
    this.profile = normalizeProfile(this.profile)
    return { ...this.profile }
  }

  updateProfile(updates: Partial<AvatarProfile>): AvatarProfile {
    this.profile = normalizeProfile({
      ...this.profile,
      ...updates,
      updatedAt: Date.now()
    })
    this.saveProfile()
    return this.getProfile()
  }

  private loadProfile(): {
    profile: AvatarProfile
    needsSave: boolean
    shouldClearLegacySettings: boolean
  } {
    try {
      if (fs.existsSync(this.profilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.profilePath, 'utf-8')) as Partial<AvatarProfile>
        const currentProfile = normalizeProfile({ ...buildDefaultProfile(), ...raw } as AvatarProfile)
        const merged = mergeLegacyProfileFields(currentProfile)
        const normalizedProfile = normalizeProfile(merged.profile)

        return {
          profile: normalizedProfile,
          needsSave: JSON.stringify(currentProfile) !== JSON.stringify(normalizedProfile),
          shouldClearLegacySettings: merged.hasLegacyKeys
        }
      }
    } catch (error) {
      console.error('Failed to load avatar profile:', error)
    }

    const merged = mergeLegacyProfileFields(buildDefaultProfile())
    return {
      profile: normalizeProfile(merged.profile),
      needsSave: true,
      shouldClearLegacySettings: merged.hasLegacyKeys
    }
  }

  private saveProfile(): void {
    try {
      fs.mkdirSync(path.dirname(this.profilePath), { recursive: true })
      fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2))
    } catch (error) {
      console.error('Failed to save avatar profile:', error)
    }
  }

  private clearLegacyProfileFieldsFromSettings(): void {
    try {
      const legacySettingsPath = getLegacySettingsPath()
      if (!fs.existsSync(legacySettingsPath)) {
        return
      }

      const raw = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf-8')) as Record<string, unknown>
      let changed = false

      for (const key of LEGACY_PROFILE_SETTING_KEYS) {
        if (key in raw) {
          delete raw[key]
          changed = true
        }
      }

      if (changed) {
        fs.writeFileSync(legacySettingsPath, JSON.stringify(raw, null, 2))
      }
    } catch (error) {
      console.warn('Failed to clear legacy avatar fields from settings:', error)
    }
  }
}
