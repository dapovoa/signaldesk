import { BrowserWindow, desktopCapturer } from 'electron'

export interface ScreenshotResult {
  success: boolean
  imageData?: string // base64 data URL
  error?: string
  sourceId?: string
  sourceType?: 'window' | 'screen'
}

/**
 * Service to capture screenshots of the active window
 */
export class ScreenshotService {
  private appWindowTitle?: string

  constructor(appWindow?: BrowserWindow) {
    // Get the app window title to exclude it from capture
    if (appWindow) {
      this.appWindowTitle = appWindow.getTitle()
    }
  }

  /**
   * Captures the currently active/focused window (excluding the AI assistant app)
   * @returns Base64 encoded image data URL
   */
  async captureActiveWindow(
    preferredSourceId?: string,
    preferredSourceType?: 'window' | 'screen' | 'auto'
  ): Promise<ScreenshotResult> {
    if (preferredSourceId && preferredSourceType && preferredSourceType !== 'auto') {
      const preferredAttempt = await this.captureFromPreferredSource(
        preferredSourceId,
        preferredSourceType
      )
      if (preferredAttempt.success) {
        return preferredAttempt
      }
    }

    const windowAttempt = await this.captureBestWindow()
    if (windowAttempt.success) {
      return windowAttempt
    }

    // Wayland/portal flows often fail for window enumeration but still allow full-screen capture.
    if (process.platform === 'linux') {
      const screenAttempt = await this.captureBestScreen()
      if (screenAttempt.success) {
        return screenAttempt
      }

      return {
        success: false,
        error: this.getPreferredCaptureError(windowAttempt.error, screenAttempt.error)
      }
    }

    return windowAttempt
  }

  private async captureFromPreferredSource(
    sourceId: string,
    sourceType: 'window' | 'screen'
  ): Promise<ScreenshotResult> {
    try {
      const sources = await desktopCapturer.getSources({
        types: [sourceType],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })

      const matchedSource = sources.find((source) => source.id === sourceId)
      if (!matchedSource || matchedSource.thumbnail.isEmpty()) {
        return {
          success: false,
          error: 'Saved capture source is no longer available'
        }
      }

      return {
        success: true,
        imageData: matchedSource.thumbnail.toDataURL(),
        sourceId: matchedSource.id,
        sourceType
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      if (!this.isExpectedPortalError(errorMessage)) {
        console.error('Saved source capture error:', errorMessage)
      }
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  private async captureBestWindow(): Promise<ScreenshotResult> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })

      if (sources.length === 0) {
        return {
          success: false,
          error: 'No windows available to capture'
        }
      }

      const appWindowPatterns = [
        'SignalDesk',
        'signaldesk',
        'interview',
        'electron',
        this.appWindowTitle?.toLowerCase() || ''
      ].filter(Boolean)

      const filteredSources = sources.filter((source) => {
        const sourceNameLower = source.name.toLowerCase()
        const isAppWindow = appWindowPatterns.some((pattern) => {
          if (!pattern) return false
          return sourceNameLower.includes(pattern) || sourceNameLower === pattern
        })

        const isElectronDev =
          sourceNameLower.includes('electron') &&
          (sourceNameLower.includes('devtools') || sourceNameLower.includes('dev tools'))

        return !isAppWindow && !isElectronDev && !source.thumbnail.isEmpty()
      })

      if (filteredSources.length === 0) {
        return {
          success: false,
          error: 'No usable external windows available to capture'
        }
      }

      const browserKeywords = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'brave', 'browser']
      const browserSource = filteredSources.find((source) => {
        const nameLower = source.name.toLowerCase()
        return browserKeywords.some((keyword) => nameLower.includes(keyword))
      })

      const activeSource = browserSource || filteredSources[0]

      if (!activeSource || activeSource.thumbnail.isEmpty()) {
        return {
          success: false,
          error: 'Failed to capture window thumbnail'
        }
      }

      const image = activeSource.thumbnail
      const imageDataUrl = image.toDataURL()

      return {
        success: true,
        imageData: imageDataUrl,
        sourceId: activeSource.id,
        sourceType: 'window'
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      if (!this.isExpectedPortalError(errorMessage)) {
        console.error('Screenshot capture error:', errorMessage)
      }
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  private async captureBestScreen(): Promise<ScreenshotResult> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })

      const usableSources = sources.filter((source) => !source.thumbnail.isEmpty())
      if (usableSources.length === 0) {
        return {
          success: false,
          error: 'No screens available to capture'
        }
      }

      const activeSource = usableSources[0]

      return {
        success: true,
        imageData: activeSource.thumbnail.toDataURL(),
        sourceId: activeSource.id,
        sourceType: 'screen'
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      if (!this.isExpectedPortalError(errorMessage)) {
        console.error('Screen fallback capture error:', errorMessage)
      }
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  private getPreferredCaptureError(windowError?: string, screenError?: string): string {
    const combined = `${windowError || ''} ${screenError || ''}`.toLowerCase()

    if (
      combined.includes('screencastportal') ||
      combined.includes('failed to start the screen cast session') ||
      combined.includes('egl_not_initialized') ||
      combined.includes('unknown error occurred')
    ) {
      return 'Screenshot canceled'
    }

    return screenError || windowError || 'Screenshot unavailable'
  }

  private isExpectedPortalError(message?: string): boolean {
    const text = (message || '').toLowerCase()
    return (
      text.includes('screencastportal') ||
      text.includes('failed to start the screen cast session') ||
      text.includes('egl_not_initialized') ||
      text.includes('unknown error occurred')
    )
  }
}
