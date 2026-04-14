export interface AvatarPromptVariables {
  identityBase: string
  answerStyle: string
  interviewContext: string
  retrievedCandidateMemory: string
}

export type AvatarInterviewIntent =
  | 'audio_check'
  | 'background_experience'
  | 'production_incident'
  | 'technical_explanation'
  | 'project'
  | 'generic_python_script'
  | 'default'

const renderAvatarPromptVariables = (variables: AvatarPromptVariables): string => {
  const sections = [
    { label: 'Identity Base', value: variables.identityBase.trim() },
    { label: 'Answer Style', value: variables.answerStyle.trim() },
    { label: 'Interview Context', value: variables.interviewContext.trim() },
    {
      label: 'Candidate Knowledge',
      value: variables.retrievedCandidateMemory.trim()
    }
  ].filter((section) => section.value)

  if (sections.length === 0) return ''

  return sections.map((section) => `${section.label}:\n${section.value}`).join('\n\n')
}

type PromptLanguage = 'pt' | 'en' | 'mixed'

const PT_LANGUAGE_SIGNALS = [
  'como',
  'porque',
  'porquê',
  'qual',
  'quais',
  'onde',
  'quando',
  'fala-me',
  'fala',
  'explica',
  'explicarias',
  'sobre',
  'utilizavas',
  'apresenta-me',
  'apresenta',
  'mostra-me',
  'mostra',
  'experiência',
  'equipa',
  'empresa',
  'função',
  'sistema',
  'infraestrutura',
  'desempenho',
  'problema',
  'produção',
  'impacto',
  'utilizadores',
  'código'
]

const EN_LANGUAGE_SIGNALS = [
  'how',
  'why',
  'what',
  'which',
  'where',
  'when',
  'tell',
  'walk',
  'through',
  'background',
  'experience',
  'team',
  'company',
  'role',
  'system',
  'infrastructure',
  'performance',
  'problem',
  'production',
  'impact',
  'users',
  'snippet',
  'code'
]

const LANGUAGE_NEUTRAL_TECH_TERMS = new Set([
  'api',
  'backend',
  'frontend',
  'docker',
  'kubernetes',
  'linux',
  'windows',
  'python',
  'javascript',
  'typescript',
  'postgresql',
  'mysql',
  'redis',
  'nginx',
  'network',
  'networks',
  'sap',
  'sql',
  'git'
])

const tokenizeLanguageHints = (question: string): string[] =>
  question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .match(/[\p{L}\p{N}-]{2,}/gu) || []

const countLanguageSignals = (
  tokens: string[],
  signals: string[]
): number => tokens.filter((token) => signals.includes(token) && !LANGUAGE_NEUTRAL_TECH_TERMS.has(token)).length

const detectPromptLanguage = (question: string): PromptLanguage => {
  const tokens = tokenizeLanguageHints(question)
  const ptCount = countLanguageSignals(tokens, PT_LANGUAGE_SIGNALS)
  const enCount = countLanguageSignals(tokens, EN_LANGUAGE_SIGNALS)

  if (ptCount === 0 && enCount === 0) {
    return 'en'
  }

  if (ptCount > 0 && enCount > 0) {
    const delta = Math.abs(ptCount - enCount)
    if (delta <= 1) return 'mixed'
    return ptCount > enCount ? 'pt' : 'en'
  }

  return ptCount > 0 ? 'pt' : 'en'
}

const getLanguageOverlay = (question: string): string => {
  const language = detectPromptLanguage(question)

  if (language === 'pt') {
    return `
Language overlay for this answer:
- Respond in European Portuguese (pt-PT).
- Keep technical terms, product names, and code identifiers in their natural language when that reads better.`
  }

  if (language === 'mixed') {
    return `
Language overlay for this answer:
- Respond mainly in the dominant natural language of the question.
- Keep technical terms, product names, and code identifiers in their natural language.
- If the question is genuinely mixed, mirror that naturally without forcing translation of technical terms.`
  }

  return `
Language overlay for this answer:
- Respond in English.
- Keep technical terms and code identifiers unchanged.`
}

export const detectAvatarInterviewIntent = (question: string): AvatarInterviewIntent => {
  const lower = question.toLowerCase()
  const normalized = ` ${lower} `

  if (
    /(can you hear me|hear me well|hear me clearly|can you hear me okay|can you hear me ok|can you hear me fine|audio ok|audio okay|sound ok|sound okay|mic check|microphone check)/.test(
      lower
    )
  ) {
    return 'audio_check'
  }

  if (
    [
      ' tell me about yourself ',
      ' walk me through your experience ',
      ' your experience ',
      ' your background ',
      ' what have you been doing ',
      ' what you have been doing ',
      ' can you walk me through ',
      ' fala-me de ti ',
      ' fala me de ti ',
      ' a tua experiência ',
      ' seu percurso ',
      ' teu percurso ',
      ' teu background '
    ].some((signal) => normalized.includes(signal))
  ) {
    return 'background_experience'
  }

  if (
    /(production|incident|outage|impact|users|business|root cause|step by step|problema|produção|impacto|utilizadores|passo a passo)/.test(
      lower
    ) && /(problem|issue|incident|problema|falha|error|erro|handle|handled|approach|resolve|resolved)/.test(lower)
  ) {
    return 'production_incident'
  }

  if (/(project|projects|personal project|practice project|portfolio|projeto|projetos)/.test(lower)) {
    return 'project'
  }

  if (/(python|script|automation script)/.test(lower) && !/(data pipeline|data flow|ingestion|warehouse|batch)/.test(lower)) {
    return 'generic_python_script'
  }

  if (
    /(explain|how do you explain|complex issue|complex issues|someone who doesn't understand|someone who does not understand|explicas|explicar|explicarias)/.test(
      lower
    )
  ) {
    return 'technical_explanation'
  }

  return 'default'
}

const getIntentRules = (intent: AvatarInterviewIntent): string[] => {
  switch (intent) {
    case 'audio_check':
      return [
        'For audio or microphone check questions: answer minimally and stop.',
        'Do not continue the conversation, add greetings, or offer help.'
      ]
    case 'background_experience':
      return [
        'For background or experience questions: answer with work trajectory first.',
        'Focus on the last few years and the main kinds of systems or problems handled.',
        'Do not answer with generic mindset, philosophy, or problem-solving style.'
      ]
    case 'production_incident':
      return [
        'For production incident questions: start with the concrete incident.',
        'Say what was impacted, what you checked first, and what fixed or stabilized it.'
      ]
    case 'technical_explanation':
      return [
        'For technical explanation questions: start with impact or practical meaning first.',
        'Then explain the simplest useful part of the technical cause.'
      ]
    case 'project':
      return [
        'For project questions: talk about what you built, why it mattered, and the main technical decisions.'
      ]
    case 'generic_python_script':
      return [
        'For generic Python or script questions: do not default to data pipeline examples unless the question asks for that context.'
      ]
    default:
      return []
  }
}

const getSharedInterviewPrompt = (question: string, variables: AvatarPromptVariables): string => {
  const structuredContext = renderAvatarPromptVariables(variables)
  const languageOverlay = getLanguageOverlay(question)
  const intent = detectAvatarInterviewIntent(question)
  const intentRules = getIntentRules(intent)

  return `
You are me in a real technical interview.

${
  structuredContext
    ? `Use this context when it is relevant:
${structuredContext}
`
    : ''
}

Fixed rules:
- Answer the current question, not a nearby one.
- Use first person singular ("I") unless the interviewer is clearly asking about team coordination.
- Use the provided context only when it is relevant to the question.
- Prefer real work experience and production incidents over personal projects.
- Mention personal projects only when the interviewer explicitly asks about projects, portfolio, or side work.
- Do not present role requirements or company context as if they were already my own past experience.
- Do not invent company facts, product details, team details, or business context if they are not provided.
- Do not claim I have used a specific tool, service, framework, or platform unless it is grounded in the provided context as my own past experience.
- If the interviewer mentions a tool, framework, or platform, treat that as a hypothetical or target environment unless my own prior use is grounded in the provided context.
- Never invent named tools, products, services, or frameworks just to make the answer sound more complete.
- If something is not grounded, keep it generic or say what I would check first.
- Plain text only. No markdown, no bullets, no numbered lists, no headings.
- Default to 2 sentences. Hard maximum: 3 sentences.
- Focus on one useful path and stop.
- Keep the answer easy to say out loud.
${intentRules.map((rule) => `- ${rule}`).join('\n')}

${languageOverlay}
`
}

export const buildAvatarAnswerPrompt = (
  question: string,
  variables: AvatarPromptVariables
): string => `${getSharedInterviewPrompt(question, variables)}`

export const buildAvatarSolutionPrompt = (
  question: string,
  variables: AvatarPromptVariables,
  questionType?: 'leetcode' | 'system-design' | 'other'
): string => {
  const sharedPrompt = getSharedInterviewPrompt(question, variables)

  if (questionType === 'leetcode') {
    return `${sharedPrompt}

This is a coding problem from a live interview.
- Start with the approach and the key data structure or algorithm.
- Do not output markdown, bullets, headings, or code unless the interviewer explicitly asks to write code.
- Mention complexity only if it materially supports the answer.`
  }

  if (questionType === 'system-design') {
    return `${sharedPrompt}

This is a system design discussion from a live interview.
- Clarify assumptions when needed.
- Walk through the design in a practical order.
- Mention trade-offs only when they matter to the design choice.
- Do not output markdown, bullets, headings, or long structured sections.`
  }

  return `${sharedPrompt}

This is a live technical interview question.
- Answer it directly.
- Keep the explanation practical.
- Add extra detail only when the question clearly needs it.
- Do not output markdown, bullets, headings, or long structured sections.`
}
