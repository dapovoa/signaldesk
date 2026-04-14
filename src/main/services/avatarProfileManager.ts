import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AvatarProfile } from '../../shared/contracts'
export type { AvatarIndexStatus, AvatarProfile } from '../../shared/contracts'

export const getDefaultAvatarRoot = (): string => path.join(app.getPath('userData'), 'avatar')

export const getDefaultAvatarSourceDirectory = (): string =>
  path.join(getDefaultAvatarRoot(), 'sources')

const getLegacySettingsPath = (): string => path.join(app.getPath('userData'), 'settings.json')
const LEGACY_PROFILE_SETTING_KEYS = [
  'identityBase',
  'answerStyle',
  'cvSummary',
  'jobTitle',
  'companyName',
  'jobDescription',
  'companyContext',
  'resumeDescription'
] as const

const AVATAR_LIMITS = {
  identityBase: 2400,
  answerStyle: 700,
  cvSummary: 700,
  jobTitle: 60,
  companyName: 30,
  jobDescription: 1600,
  companyContext: 250
} as const

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

  return pickFirstNonEmpty(
    normalizedProfileIdentityBase ? profileIdentityBase : '',
    legacyIdentityBase,
    ''
  )
}

const buildDefaultProfile = (): AvatarProfile => {
  return {
    id: 'default',
    identityBase: '',
    answerStyle: '',
    cvSummary: '',
    jobTitle: '',
    companyName: '',
    jobDescription: '',
    companyContext: '',
    sourceDirectory: getDefaultAvatarSourceDirectory(),
    embeddingModel: '',
    embeddingModelDir: '',
    updatedAt: Date.now()
  }
}

const normalizeProfile = (profile: AvatarProfile): AvatarProfile => ({
  ...profile,
  identityBase: clampText(profile.identityBase, AVATAR_LIMITS.identityBase),
  answerStyle: clampText(profile.answerStyle, AVATAR_LIMITS.answerStyle),
  cvSummary: clampText(profile.cvSummary, AVATAR_LIMITS.cvSummary),
  jobTitle: clampText(profile.jobTitle, AVATAR_LIMITS.jobTitle),
  companyName: clampText(profile.companyName, AVATAR_LIMITS.companyName),
  jobDescription: clampText(profile.jobDescription, AVATAR_LIMITS.jobDescription),
  companyContext: clampText(profile.companyContext, AVATAR_LIMITS.companyContext),
  sourceDirectory: getDefaultAvatarSourceDirectory(),
  embeddingModel: profile.embeddingModel?.trim() || buildDefaultProfile().embeddingModel,
  embeddingModelDir: profile.embeddingModelDir?.trim() || buildDefaultProfile().embeddingModelDir,
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
        answerStyle: typeof raw.answerStyle === 'string' ? raw.answerStyle : undefined,
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
      answerStyle: pickFirstNonEmpty(profile.answerStyle, legacy.fields.answerStyle),
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
