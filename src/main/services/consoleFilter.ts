const VERBOSE_FLAG_KEYS = [
  'SIGNALDESK_VERBOSE',
  'SIGNALDESK_PIPELINE_VERBOSE',
  'SIGNALDESK_AVATAR_VERBOSE'
] as const

const isTruthyEnvValue = (value: string | undefined): boolean => {
  const normalized = (value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const isVerboseLoggingEnabled = (): boolean =>
  VERBOSE_FLAG_KEYS.some((key) => isTruthyEnvValue(process.env[key]))

const CONSOLE_FILTER_KEY = Symbol.for('signaldesk.main.consoleFilterInstalled')

type ConsoleState = typeof globalThis & {
  [CONSOLE_FILTER_KEY]?: boolean
}

const installMainConsoleFilter = (): void => {
  const globalState = globalThis as ConsoleState
  if (globalState[CONSOLE_FILTER_KEY]) {
    return
  }

  globalState[CONSOLE_FILTER_KEY] = true

  if (isVerboseLoggingEnabled()) {
    return
  }

  console.log = () => undefined
  console.info = () => undefined
  console.debug = () => undefined
}

installMainConsoleFilter()

