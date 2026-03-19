import { useEffect } from 'react'
import { AnswerPanel } from './components/AnswerPanel'
import { Header } from './components/Header'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useInterviewEvents } from './hooks/useInterviewEvents'
import { useInterviewStore } from './store/interviewStore'

function App(): React.JSX.Element {
  const { settings, showHistory, setShowHistory } = useInterviewStore()

  // Set up IPC event listeners ONCE at the app level
  useInterviewEvents()

  // Apply window opacity from settings
  useEffect(() => {
    if (settings.windowOpacity && settings.windowOpacity !== 1) {
      window.api.setWindowOpacity(settings.windowOpacity)
    }
  }, [settings.windowOpacity])

  return (
    <div className="flex h-screen overflow-hidden bg-transparent text-dark-100">
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Header />
        <StatusBar />
        <main className="relative flex-1 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden">
            <TranscriptPanel />
            {showHistory ? <HistoryPanel onClose={() => setShowHistory(false)} /> : <AnswerPanel />}
          </div>
        </main>
      </div>
      <SettingsModal />
    </div>
  )
}

export default App
