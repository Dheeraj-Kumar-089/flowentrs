import { useEffect, useRef, useState } from 'react'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const wakeApi = import.meta.env.VITE_WAKE_API_URL?.replace(/\/$/, '')

export default function SplashScreen({ onSandboxCreated, notice }) {
  const landingShellRef = useRef(null)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [loadingProjectId, setLoadingProjectId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState('')
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [wakeCode, setWakeCode] = useState('')
  const [waking, setWaking] = useState(false)
  const [wakeMessage, setWakeMessage] = useState('')
  const [sessionRefresh, setSessionRefresh] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('landing-page')
    return () => document.documentElement.classList.remove('landing-page')
  }, [])

  const loadProjects = async () => {
    setProjectsLoading(true)
    try {
      const response = await fetch('/api/sandbox/project', {
        credentials: 'include',
        cache: 'no-store'
      })
      if (!response.ok) throw new Error(`Unable to load projects (${response.status})`)
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadSession = async () => {
      setAuthLoading(true)
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(8000)
        })
        if (!response.ok) throw new Error(`Session service unavailable (${response.status})`)
        const data = await response.json()
        if (!active) return
        setBackendUnavailable(false)
        if (data.loggedIn && data.user) {
          setUser(data.user)
          await loadProjects()
        }
      } catch {
        if (active) {
          setUser(null)
          if (wakeApi) setBackendUnavailable(true)
        }
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    loadSession()
    return () => { active = false }
  }, [sessionRefresh])

  const wakeBackend = async () => {
    if (!wakeCode.trim()) {
      setError('Enter the demo access code first')
      return
    }

    setWaking(true)
    setError('')
    setWakeMessage('Starting the demo server')
    try {
      const response = await fetch(`${wakeApi}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: wakeCode.trim() })
      })
      const start = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(start.message || 'Unable to start the demo server')

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(3000)
        const statusResponse = await fetch(`${wakeApi}/status`, { cache: 'no-store' })
        if (!statusResponse.ok) continue
        const status = await statusResponse.json()
        setWakeMessage(status.state === 'running' ? 'Connecting to workspace services' : 'Starting the demo server')
        if (status.state !== 'running') continue

        try {
          const sessionResponse = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
          if (!sessionResponse.ok) continue
          await sessionResponse.json()
          setBackendUnavailable(false)
          setWakeCode('')
          setSessionRefresh(value => value + 1)
          return
        } catch {
          // The VM is running, but the application may still be starting.
        }
      }
      throw new Error('The server is taking longer than expected. Try again in a moment.')
    } catch (wakeError) {
      setError(wakeError.message || 'Unable to start the demo server')
    } finally {
      setWaking(false)
      setWakeMessage('')
    }
  }

  useEffect(() => {
    const shell = landingShellRef.current
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    if (!shell || !finePointer.matches) return undefined

    let frameId = 0
    let pointerX = 0
    let pointerY = 0

    const renderGlow = () => {
      shell.style.setProperty('--grid-glow-x', `${pointerX}px`)
      shell.style.setProperty('--grid-glow-y', `${pointerY}px`)
      frameId = 0
    }

    const handlePointerMove = (event) => {
      pointerX = event.clientX
      pointerY = event.clientY
      shell.style.setProperty('--grid-glow-opacity', '1')
      if (!frameId) frameId = window.requestAnimationFrame(renderGlow)
    }

    const hideGlow = () => shell.style.setProperty('--grid-glow-opacity', '0')

    shell.addEventListener('pointermove', handlePointerMove, { passive: true })
    shell.addEventListener('pointerleave', hideGlow)
    return () => {
      shell.removeEventListener('pointermove', handlePointerMove)
      shell.removeEventListener('pointerleave', hideGlow)
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [])

  const waitForSandboxReady = async (sandboxData) => {
    let lastReason = 'Sandbox did not become ready in time'
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(`/api/sandbox/status/${sandboxData.sandboxId}`, {
        credentials: 'include',
        cache: 'no-store'
      })
      if (!response.ok) throw new Error(`Unable to check sandbox status (${response.status})`)
      const status = await response.json()
      if (status.status === 'ready') return sandboxData
      if (status.status === 'failed') throw new Error(status.reason || 'Sandbox failed to start')
      lastReason = status.reason || lastReason
      await sleep(1500)
    }
    throw new Error(lastReason)
  }

  const startProject = async (projectId) => {
    setError('')
    setLoadingProjectId(projectId)
    setLoadingLabel('Allocating isolated runtime')
    try {
      const response = await fetch('/api/sandbox/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || `Unable to start sandbox (${response.status})`)
      setLoadingLabel('Waiting for workspace services')
      onSandboxCreated(await waitForSandboxReady(data))
    } catch (requestError) {
      setError(requestError.message || 'Unable to start sandbox')
      setLoadingProjectId(null)
      setLoadingLabel('')
    }
  }

  const createProject = async () => {
    const projectTitle = title.trim()
    if (!projectTitle) {
      setError('Enter a project name first')
      return
    }
    setCreating(true)
    setError('')
    setLoadingLabel('Creating project')
    try {
      const response = await fetch('/api/sandbox/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: projectTitle })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || `Unable to create project (${response.status})`)
      setTitle('')
      await startProject(data.project._id)
    } catch (requestError) {
      setError(requestError.message || 'Unable to create project')
      setLoadingLabel('')
    } finally {
      setCreating(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setUser(null)
    setProjects([])
    setError('')
  }

  const busy = creating || loadingProjectId !== null

  return (
    <div ref={landingShellRef} className="landing-shell min-h-full w-full overflow-y-auto">
      <div className="landing-grid" aria-hidden="true" />

      <nav className="landing-nav relative z-10 flex items-center justify-between px-5 md:px-10">
        <a href="/" className="flex items-center gap-3 text-white" aria-label="Flowent home">
          <span className="brand-mark brand-mark-large flex items-center justify-center">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M14 10l-2 1-2-1m2 1v3"/><path d="M20 7l-8-4-8 4v10l8 4 8-4V7z"/>
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight">flowent</span>
          <span className="product-badge hidden sm:inline-flex">Cloud IDE</span>
        </a>

        <div className="flex items-center gap-3">
          {authLoading ? (
            <span className="button-spinner" aria-label="Checking session" />
          ) : user ? (
            <>
              <div className="hidden sm:flex items-center gap-2 border border-white/10 bg-[#14161c] px-2 h-8">
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-5 w-5 object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="h-5 w-5 bg-[#e09f3e] text-black text-[11px] font-bold flex items-center justify-center">
                    {user.name?.charAt(0) || 'U'}
                  </span>
                )}
                <span className="text-xs text-[#d4d7dc] max-w-32 truncate">{user.name}</span>
              </div>
              <button type="button" onClick={handleLogout} className="secondary-button h-8 px-3">Sign out</button>
            </>
          ) : backendUnavailable ? (
            <span className="runtime-chip">Demo sleeping</span>
          ) : (
            <a href="/api/auth/google" className="secondary-button h-9 px-4 inline-flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
                <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.8 0 12s.7 3.3 1.9 5.7l3.7-2.9z"/>
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.8-2.5 1.3-4.3 1.3-3 0-5.5-2-6.4-4.8L1.9 16.5C3.7 20.4 7.5 23 12 23z"/>
              </svg>
              Sign in
            </a>
          )}
        </div>
      </nav>

      <main className="landing-main relative z-10 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-14 items-center px-5 md:px-10 py-10 lg:py-14 mx-auto">
        <section className="max-w-2xl">
          <div className="eyebrow"><span className={`status-dot ${backendUnavailable ? 'bg-[#e09f3e]' : 'bg-[#10b981]'}`} /> {backendUnavailable ? 'Demo server is sleeping' : 'Kubernetes runtime online'}</div>
          <h1 className="landing-title mt-6">Build software with AI in real time.</h1>
          <p className="landing-copy mt-5">
            Launch an isolated cloud workspace with a VS Code-style editor, live Vite preview, interactive shell, and an AI agent that works directly in your project.
          </p>

          <div className="feature-grid mt-8">
            {[
              ['01', 'AI file operations', 'Read and update the live workspace'],
              ['02', 'Instant preview', 'See Vite changes without rebuilding'],
              ['03', 'Real shell access', 'Use a persistent interactive terminal'],
              ['04', 'Isolated runtime', 'One Kubernetes sandbox per project']
            ].map(([number, heading, detail]) => (
              <div key={number} className="feature-row">
                <span className="feature-number">{number}</span>
                <div><strong>{heading}</strong><span>{detail}</span></div>
              </div>
            ))}
          </div>
        </section>

        <section className="launch-panel" aria-labelledby="launch-title">
          <div className="launch-panel-header">
            <div>
              <p className="panel-kicker">Workspace launcher</p>
              <h2 id="launch-title">Open your development environment</h2>
            </div>
            <span className="runtime-chip">{import.meta.env.VITE_RUNTIME_LABEL || 'EKS'}</span>
          </div>

          {notice && <div className="notice-banner" role="status">{notice}</div>}
          {error && <div className="error-banner" role="alert">{error}</div>}

          {backendUnavailable && wakeApi ? (
            <div className="wake-state">
              <h3>Start the live demo</h3>
              <p>The server rests when no workspace is active. Enter the access code to bring it online, then sign in.</p>
              <label htmlFor="wake-code">Demo access code</label>
              <input
                id="wake-code"
                type="password"
                value={wakeCode}
                onChange={event => setWakeCode(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !waking) wakeBackend() }}
                disabled={waking}
                autoComplete="off"
              />
              <button type="button" onClick={wakeBackend} disabled={waking} className="primary-button wake-button">
                {waking ? 'Starting server…' : 'Start demo server'}
              </button>
              {waking && <p className="wake-progress" role="status"><span className="button-spinner" aria-hidden="true" /> {wakeMessage}</p>}
            </div>
          ) : !user && !authLoading ? (
            <div className="signed-out-state">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16"/><path d="M8 9h8M8 13h5"/>
              </svg>
              <h3>Sign in to access projects</h3>
              <p>Your project list and sandbox ownership are protected by your account.</p>
              <a href="/api/auth/google" className="primary-button w-full h-11 inline-flex items-center justify-center">Continue with Google</a>
            </div>
          ) : (
            <>
              <div className="project-section">
                <div className="section-label-row"><span>Recent projects</span><span>{projects.length}</span></div>
                <div className="project-list" aria-busy={projectsLoading || busy}>
                  {projectsLoading ? (
                    <div className="empty-projects"><span className="button-spinner" /> Loading projects</div>
                  ) : projects.length ? projects.map(project => (
                    <button
                      type="button"
                      key={project._id}
                      onClick={() => startProject(project._id)}
                      disabled={busy}
                      className="project-row"
                    >
                      <span className="project-icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h7l2 2h9v10H3z"/></svg>
                      </span>
                      <span className="min-w-0"><strong>{project.title}</strong><small>{String(project._id).slice(-8)}</small></span>
                      {loadingProjectId === project._id ? <span className="button-spinner" /> : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                      )}
                    </button>
                  )) : (
                    <div className="empty-projects">No projects yet. Create your first workspace below.</div>
                  )}
                </div>
              </div>

              <div className="create-project-form">
                <label htmlFor="project-name">New project</label>
                <div className="flex">
                  <input
                    id="project-name"
                    value={title}
                    onChange={event => { setTitle(event.target.value); setError('') }}
                    onKeyDown={event => event.key === 'Enter' && !busy && createProject()}
                    placeholder="e.g. Customer dashboard"
                    disabled={busy || authLoading}
                  />
                  <button type="button" onClick={createProject} disabled={busy || authLoading} className="primary-button px-5">
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </>
          )}

          {busy && <div className="launch-progress" role="status"><span className="button-spinner" /> {loadingLabel}</div>}
        </section>
      </main>

      <footer className="landing-footer relative z-10 flex flex-col sm:flex-row gap-2 items-center justify-between px-5 md:px-10">
        <span>Flowent Cloud IDE</span><span>AI-assisted · Isolated · Zero configuration</span><span>© 2026</span>
      </footer>
    </div>
  )
}
