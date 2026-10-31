import { useState, useRef, useCallback, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import TopBar from './components/TopBar'
import FileExplorer from './components/FileExplorer'
import PreviewFrame from './components/PreviewFrame'
import FileViewer from './components/FileViewer'
import Terminal from './components/Terminal'
import AiChat from './components/AiChat'
import { sandboxHost } from './lib/sandboxHosts'

export default function App() {
  // Sandbox state
  const [sandbox, setSandbox] = useState(null) // { sandboxId, projectId, previewUrl, agentBase }
  const [status, setStatus] = useState('ready')

  // UI state
  const [activeTab, setActiveTab] = useState('preview') // 'preview' | 'files'
  const [activeFile, setActiveFile] = useState(null)
  const [fileRefreshKey, setFileRefreshKey] = useState(0)
  const [deletingSandbox, setDeletingSandbox] = useState(false)
  const [homeNotice, setHomeNotice] = useState('')

  // Terminal resize
  const [terminalHeight, setTerminalHeight] = useState(220)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  useEffect(() => {
    if (window.location.pathname !== '/') {
      window.location.replace('/')
    }
  }, [])

  const handleSandboxCreated = useCallback((data) => {
    const agentBase = sandboxHost(data.sandboxId, 'agent')
    setSandbox({ sandboxId: data.sandboxId, projectId: data.projectId, previewUrl: data.previewUrl, agentBase })
    setStatus('ready')
    setHomeNotice('')
  }, [])

  const handleReturnHome = useCallback(() => {
    setSandbox(null)
    setActiveFile(null)
    setActiveTab('preview')
    setHomeNotice('Your sandbox is still running and can be reopened from its project.')
    window.history.replaceState({}, '', '/')
  }, [])

  const handleDeleteSandbox = useCallback(async () => {
    if (!sandbox || deletingSandbox) return
    const confirmed = window.confirm('Permanently delete this project? This removes its sandbox pod, all saved S3 files and versions, and its database record. This cannot be undone.')
    if (!confirmed) return

    setDeletingSandbox(true)
    try {
      const response = await fetch(`/api/sandbox/${sandbox.sandboxId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: sandbox.projectId }),
        credentials: 'include'
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || `Delete failed (${response.status})`)

      setSandbox(null)
      setActiveFile(null)
      setActiveTab('preview')
      setHomeNotice('Project, sandbox pod, and stored files deleted permanently.')
      window.history.replaceState({}, '', '/')
    } catch (error) {
      window.alert(error.message || 'Failed to delete sandbox')
    } finally {
      setDeletingSandbox(false)
    }
  }, [sandbox, deletingSandbox])

  const handleFilesChanged = useCallback(() => {
    setFileRefreshKey(k => k + 1)
  }, [])

  const handleFileSelect = useCallback((path) => {
    setActiveFile(path)
    setActiveTab('files')
  }, [])

  // Drag to resize terminal
  const handleDragStart = (e) => {
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartH.current = terminalHeight

    const onMove = (ev) => {
      if (!isDragging.current) return
      const delta = dragStartY.current - ev.clientY
      const newH = Math.min(Math.max(dragStartH.current + delta, 80), 500)
      setTerminalHeight(newH)
    }
    const onUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Landing / splash
  if (!sandbox) {
    return <SplashScreen onSandboxCreated={handleSandboxCreated} notice={homeNotice} />
  }

  const { sandboxId, previewUrl, agentBase } = sandbox

  return (
    <div className="workspace-shell flex flex-col h-full w-full overflow-hidden"
      style={{ background: '#090a0d' }}>

      {/* Top bar */}
      <TopBar
        sandboxId={sandboxId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        onHome={handleReturnHome}
        onDeleteSandbox={handleDeleteSandbox}
        deletingSandbox={deletingSandbox}
      />

      {/* Main layout */}
      <div className="workspace-layout flex flex-1 overflow-hidden">

        {/* File Explorer sidebar */}
        <FileExplorer
          agentBase={agentBase}
          activeFile={activeFile}
          onFileSelect={handleFileSelect}
          refreshKey={fileRefreshKey}
        />

        {/* Center — main content + terminal */}
        <div className="workspace-center flex flex-col flex-1 overflow-hidden">

          {/* Main content area */}
          <div className="workspace-main-content flex-1 overflow-hidden">
            {activeTab === 'preview' ? (
              <PreviewFrame previewUrl={previewUrl} agentBase={agentBase} />
            ) : (
              <FileViewer agentBase={agentBase} filePath={activeFile} />
            )}
          </div>

          {/* Drag handle */}
          <div
            className="workspace-terminal-resizer shrink-0 flex items-center justify-center cursor-row-resize select-none"
            style={{ height: '6px', background: '#101116', borderTop: '1px solid #262a32', borderBottom: '1px solid #262a32', zIndex: 10 }}
            onMouseDown={handleDragStart}
            title="Drag to resize terminal">
            <div className="w-12 h-px" style={{ background: '#515762' }} />
          </div>

          {/* Terminal */}
          <div
            className="workspace-terminal shrink-0 overflow-hidden"
            style={{ '--terminal-height': `${terminalHeight}px` }}
          >
            <Terminal sandboxId={sandboxId} />
          </div>
        </div>

        {/* Right — AI Chat */}
        <div className="workspace-chat shrink-0 overflow-hidden">
          <AiChat
            sandboxId={sandboxId}
            onFilesChanged={handleFilesChanged}
          />
        </div>
      </div>
    </div>
  )
}
