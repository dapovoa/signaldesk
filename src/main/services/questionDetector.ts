import { EventEmitter } from 'events'
import type { DetectedQuestion } from '../../shared/contracts'
export type { DetectedQuestion } from '../../shared/contracts'

const QUESTION_DETECTOR_VERBOSE =
  process.env.SIGNALDESK_VERBOSE === '1' || process.env.SIGNALDESK_PIPELINE_VERBOSE === '1'

export class QuestionDetector extends EventEmitter {
  private transcriptBuffer: string[] = []
  private minWords = 5
  private minChars = 28
  private confidenceThreshold = 0.68
  private readonly strongStarters = new Set([
    'what',
    'how',
    'why',
    'when',
    'where',
    'who',
    'which',
    'tell me',
    'describe',
    'explain',
    'o que',
    'como',
    'porquê',
    'porque',
    'quando',
    'onde',
    'quem',
    'qual',
    'quais',
    'diga-me',
    'explique'
  ])
  private readonly interviewPromptStarters = new Set([
    'based on your',
    'imagine',
    'suppose',
    'walk me through',
    'how would you',
    'baseado na sua',
    'baseado na tua',
    'imagine que',
    'suponha que',
    'como abordaria',
    'como abordarias',
    'pensa em'
  ])
  private readonly metaIgnoreFragments = new Set([
    'got it',
    'sorry for',
    'makes sense',
    'moving on',
    'next question',
    'no worries',
    'take it easy',
    'let\'s keep the conversation going',
    'if you\'d like to',
    'would you like to focus on first',
    'what part of the',
    'maybe automation',
    'maybe cloud',
    'maybe troubleshooting',
    'welcome to your',
    'let\'s get started',
    'great, let\'s dive in',
    'great tracking',
    'remember to',
    'nice start',
    'to deepen your approach',
    'consider ',
    'entendi',
    'desculpe',
    'desculpa',
    'faz sentido',
    'passamos à próxima',
    'passamos para a próxima'
  ])

  addTranscript(text: string, isFinal: boolean): void {
    if (isFinal && text.trim()) {
      this.transcriptBuffer.push(text.trim())
    }
  }

  checkEarlyDetection(_text: string): DetectedQuestion | null {
    return null
  }

  onUtteranceEnd(): boolean {
    const fullText = this.getCurrentBuffer()
    this.transcriptBuffer = []

    if (!fullText) return false

    if (this.shouldIgnore(fullText)) {
      if (QUESTION_DETECTOR_VERBOSE) {
        console.log(`[QuestionDetector] Ignored short/noise turn: "${fullText}"`)
      }
      return false
    }

    const detection = this.analyzeTurn(fullText)
    if (!detection || detection.confidence < this.confidenceThreshold) {
      if (QUESTION_DETECTOR_VERBOSE) {
        console.log(`[QuestionDetector] Ignored low-confidence turn: "${fullText}"`)
      }
      return false
    }

    if (QUESTION_DETECTOR_VERBOSE) {
      console.log(
        `[QuestionDetector] Turn analyzed: "${fullText}" - Confidence: ${detection.confidence.toFixed(2)}, Type: ${detection.questionType}`
      )
      console.log(`[QuestionDetector] RESPONSE NEEDED: "${fullText}"`)
    }
    this.emit('questionDetected', detection)
    return true
  }

  isQuestion(text: string): boolean {
    const normalized = this.normalizeText(text)
    return Boolean(normalized) && !this.shouldIgnore(normalized)
  }

  clearBuffer(): void {
    this.transcriptBuffer = []
  }

  getCurrentBuffer(): string {
    return this.normalizeText(this.transcriptBuffer.join(' '))
  }

  setConfidenceThreshold(_threshold: number): void {
    this.confidenceThreshold = _threshold
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  private shouldIgnore(text: string): boolean {
    if (!text) return true

    const lower = text.toLowerCase()
    const words = text.split(/\s+/).length

    if (words <= 3 && text.length < 20) {
      return true
    }

    for (const fragment of this.metaIgnoreFragments) {
      if (lower.includes(fragment)) {
        return true
      }
    }

    if (
      /^what part of .* would you like to focus on first\b/i.test(lower) ||
      /^if you'd like to\b/i.test(lower) ||
      /^no worries\b/i.test(lower) ||
      /^maybe (automation|cloud|troubleshooting)\b/i.test(lower)
    ) {
      return true
    }

    if (/^(eu|i|we|nós|my|o meu|a minha)\b/i.test(lower) && !lower.includes('?')) {
      return true
    }

    return false
  }

  private analyzeTurn(text: string): DetectedQuestion | null {
    const lower = text.toLowerCase()
    const words = lower.split(/\s+/)
    const firstWord = words[0] || ''
    const hasQuestionMark = text.trim().endsWith('?')
    const hasDirectStarter =
      this.strongStarters.has(firstWord) || this.startsWithMultiWordStarter(lower, this.strongStarters)
    const hasInterviewStarter = this.startsWithMultiWordStarter(lower, this.interviewPromptStarters)
    let confidence = 0.4

    if (hasQuestionMark) {
      confidence += 0.35
    }

    if (hasDirectStarter) {
      confidence += 0.3
    }

    if (hasInterviewStarter) {
      confidence += 0.25
    }

    // Avoid answering mentor/coaching follow-up fragments unless they are explicit questions.
    if (!hasQuestionMark && !hasDirectStarter && !hasInterviewStarter) {
      return null
    }

    if (text.length > 45) {
      confidence += 0.1
    }

    if (text.length < this.minChars || words.length < this.minWords) {
      confidence -= 0.2
    }

    if (confidence < this.confidenceThreshold) {
      return null
    }

    let questionType: DetectedQuestion['questionType'] = 'unknown'
    if (confidence >= 0.75 && text.includes('?')) {
      questionType = 'direct'
    } else if (confidence >= 0.68) {
      questionType = 'indirect'
    } else if (confidence >= 0.6) {
      questionType = 'scenario'
    }

    return {
      text,
      confidence: Math.min(0.98, confidence),
      questionType
    }
  }

  private startsWithMultiWordStarter(text: string, starters: Set<string>): boolean {
    for (const starter of starters) {
      if (starter.includes(' ') && text.startsWith(starter)) {
        return true
      }
    }

    return false
  }
}
