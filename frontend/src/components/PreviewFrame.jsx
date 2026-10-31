import { useCallback, useEffect, useRef, useState } from 'react'

export default function PreviewFrame({ previewUrl, agentBase }) {
  const iframeRef = useRef(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [validation, setValidation] = useState(null)
  const [validating, setValidating] = useState(false)

  const validateProject = useCallback(async () => {
    if (!agentBase) return

    setValidating(true)
    try {
      const response = await fetch(`${agentBase}/validate-project`, { method: 'POST' })
      if (!response.ok) throw new Error(`Validation request failed (${response.status})`)
      setValidation(await response.json())
    } catch {
      // Older running sandboxes may not expose validation yet. Their preview
      // remains available and will gain this endpoint when recreated.
    } finally {
      setValidating(false)
    }
  }, [agentBase])

  useEffect(() => {
    if (!agentBase) return undefined

    let active = true
    const readStatus = async () => {
      try {
        const response = await fetch(`${agentBase}/project-status`, { cache: 'no-store' })
        if (!response.ok) return
        const nextValidation = await response.json()
        if (active) setValidation(nextValidation)
      } catch {
        // Preview availability is independent from status polling.
      }
    }

    const initialValidation = window.setTimeout(validateProject, 0)
    const timer = window.setInterval(readStatus, 4000)
    return () => {
      active = false
      window.clearTimeout(initialValidation)
      window.clearInterval(timer)
    }
  }, [agentBase, validateProject])

  const handleRefresh = () => {
    setLoading(true)
    setRefreshKey(k => k + 1)
    validateProject()
  }

  const buildFailed = validation?.status === 'failed'

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <div className="preview-toolbar flex items-center gap-2 px-3 shrink-0"
        style={{ height: '36px', background: '#090a0d', borderBottom: '1px solid #262a32' }}>
        
        {/* Traffic light dots */}
        <div className="preview-traffic-lights flex items-center gap-1.5 mr-1">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444', opacity: 0.7 }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b', opacity: 0.7 }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981', opacity: 0.7 }} />
        </div>

        {/* URL bar */}
        <div className="flex-1 flex items-center px-3 rounded"
          style={{
            background: '#101116',
            border: '1px solid #30343d',
            height: '24px'
          }}>
          {loading && (
            <div className="w-3 h-3 rounded-full border border-t-transparent mr-2 shrink-0"
              style={{ borderColor: '#e09f3e', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          )}
          <span className="text-xs truncate" style={{ color: '#475569', fontFamily: 'monospace' }}>
            {previewUrl}
          </span>
        </div>

        {buildFailed && (
          <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: '#f87171' }}>
            Build failed
          </span>
        )}

        {/* Refresh */}
        <button onClick={handleRefresh}
          className="preview-toolbar-action p-1 rounded transition-colors cursor-pointer"
          style={{ color: '#475569' }}
          onMouseEnter={e => e.currentTarget.style.color = '#e09f3e'}
          onMouseLeave={e => e.currentTarget.style.color = '#475569'}
          title="Refresh preview">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>

        {/* Open in new tab */}
        <a href={previewUrl} target="_blank" rel="noreferrer"
          className="preview-toolbar-action p-1 rounded transition-colors cursor-pointer"
          style={{ color: '#475569' }}
          onMouseEnter={e => e.currentTarget.style.color = '#e09f3e'}
          onMouseLeave={e => e.currentTarget.style.color = '#475569'}
          title="Open in new tab">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      {/* iFrame */}
      <div className="flex-1 relative">
        <iframe
          key={refreshKey}
          ref={iframeRef}
          src={previewUrl}
          className="w-full h-full border-0"
          style={{ background: '#fff' }}
          title="Sandbox Preview"
          onLoad={() => setLoading(false)}
        />

        {buildFailed && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute inset-0 flex items-center justify-center p-6 overflow-auto"
            style={{ background: '#090a0d', color: '#eaecef' }}
          >
            <div className="w-full max-w-3xl" style={{ border: '1px solid #5f2b2b', background: '#111216' }}>
              <div className="flex items-start gap-3 p-4" style={{ borderBottom: '1px solid #3d2525' }}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" className="shrink-0 mt-0.5">
                  <path d="M12 9v4m0 4h.01" />
                  <path d="M10.3 3.7 2.4 17.4A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-sm font-semibold">Preview build failed</h2>
                  <p className="mt-1 mb-0 text-xs leading-5" style={{ color: '#a3a8b3' }}>
                    The files were saved, but Vite could not compile the project. Fix the error below, then validate again.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={validateProject}
                  disabled={validating}
                  className="min-h-11 px-4 text-xs font-semibold uppercase tracking-[0.08em]"
                  style={{ border: '1px solid #e09f3e', background: '#e09f3e', color: '#090a0d' }}
                >
                  {validating ? 'Checking…' : 'Validate again'}
                </button>
              </div>
              <pre className="m-0 p-4 overflow-auto text-xs leading-5 whitespace-pre-wrap" style={{ color: '#fca5a5', maxHeight: '48vh' }}>
                {validation.details || validation.message}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
