import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AnswerEntry } from '../../shared/contracts'

const MAX_HISTORY_LENGTH = 500

export class HistoryManager {
  private currentSession: number = 1
  private readonly historyFolder: string

  constructor() {
    this.historyFolder = path.join(app.getPath('userData'), 'history')
    this.ensureFolder()
  }

  private ensureFolder(): void {
    if (!fs.existsSync(this.historyFolder)) {
      fs.mkdirSync(this.historyFolder, { recursive: true })
    }
  }

  private getHistoryPath(session: number): string {
    return path.join(this.historyFolder, `session-${session}.json`)
  }

  private loadHistory(session: number): AnswerEntry[] {
    try {
      const historyPath = this.getHistoryPath(session)
      if (fs.existsSync(historyPath)) {
        const data = fs.readFileSync(historyPath, 'utf-8')
        const history = JSON.parse(data)
        if (Array.isArray(history)) {
          return history
        }
      }
    } catch (error) {
      console.error('Failed to load history:', error)
    }
    return []
  }

  private saveHistory(history: AnswerEntry[], session: number): void {
    try {
      this.ensureFolder()
      const historyPath = this.getHistoryPath(session)
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2))
    } catch (error) {
      console.error('Failed to save history:', error)
    }
  }

  getExistingSessions(): number[] {
    try {
      const files = fs.readdirSync(this.historyFolder)
      const sessions = new Set<number>()
      for (const file of files) {
        const match = file.match(/^session-(\d+)\.json$/)
        if (match) {
          sessions.add(parseInt(match[1], 10))
        }
      }
      return Array.from(sessions).sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  setSession(session: number): void {
    this.currentSession = Math.max(1, session)
  }

  getSession(): number {
    return this.currentSession
  }

  getHistory(): AnswerEntry[] {
    const history = this.loadHistory(this.currentSession)
    if (history.length > MAX_HISTORY_LENGTH) {
      const trimmedHistory = history.slice(0, MAX_HISTORY_LENGTH)
      this.saveHistory(trimmedHistory, this.currentSession)
      return trimmedHistory
    }
    return history
  }

  addEntry(entry: AnswerEntry): void {
    const history = this.loadHistory(this.currentSession)
    history.unshift(entry)
    const trimmedHistory = history.slice(0, MAX_HISTORY_LENGTH)
    this.saveHistory(trimmedHistory, this.currentSession)
  }

  addEntries(entries: AnswerEntry[]): void {
    const history = this.loadHistory(this.currentSession)
    const newHistory = [...entries, ...history]
    const seenIds = new Set<string>()
    const uniqueHistory = newHistory.filter((entry) => {
      if (seenIds.has(entry.id)) {
        return false
      }
      seenIds.add(entry.id)
      return true
    })
    const trimmedHistory = uniqueHistory.slice(0, MAX_HISTORY_LENGTH)
    this.saveHistory(trimmedHistory, this.currentSession)
  }

  clearHistory(): void {
    this.saveHistory([], this.currentSession)
  }

  deleteEntry(id: string): void {
    const history = this.loadHistory(this.currentSession)
    const filteredHistory = history.filter((entry) => entry.id !== id)
    this.saveHistory(filteredHistory, this.currentSession)
  }
}
