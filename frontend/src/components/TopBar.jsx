export default function TopBar({
  sandboxId,
  activeTab,
  onTabChange,
  status,
  onHome,
  onDeleteSandbox,
  deletingSandbox
}) {
  const shortId = sandboxId ? `${sandboxId.slice(0, 8)}…` : ''
  const statusConfig = {
    ready: { color: '#10b981', label: 'Ready', spinning: false },
    loading: { color: '#e09f3e', label: 'Working…', spinning: true },
    error: { color: '#ef4444', label: 'Error', spinning: false },
  }
  const currentStatus = statusConfig[status] || statusConfig.ready

  return (
    <header className="workspace-topbar flex items-center justify-between px-3 shrink-0">
      <div className="flex items-center min-w-0">
        <button
          type="button"
          onClick={onHome}
          className="brand-button flex items-center gap-2 px-2 h-8 cursor-pointer"
          title="Return to Flowent home"
          aria-label="Return to Flowent home"
        >
          <span className="brand-mark flex items-center justify-center" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path d="M14 10l-2 1-2-1m2 1v3" />
              <path d="M20 7l-8-4-8 4v10l8 4 8-4V7z" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-white">flowent</span>
        </button>

        <div className="hidden md:flex items-center gap-2 px-2 h-7 border-l border-white/10 ml-1">
          <span className="status-dot" style={{ background: currentStatus.color }} aria-hidden="true" />
          <span className="text-[11px] font-mono text-[#7d8390]">{shortId}</span>
        </div>
      </div>

      <div className="workspace-tabs flex items-center h-8" role="tablist" aria-label="Workspace view">
        {[
          { id: 'preview', label: 'Preview' },
          { id: 'files', label: 'Editor' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`h-full px-5 text-xs font-medium cursor-pointer workspace-tab ${activeTab === tab.id ? 'is-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 px-2" aria-live="polite">
          <span className={`status-dot ${currentStatus.spinning ? 'is-spinning' : ''}`}
            style={{ borderColor: currentStatus.color, background: currentStatus.spinning ? 'transparent' : currentStatus.color }} />
          <span className="text-[11px]" style={{ color: currentStatus.color }}>{currentStatus.label}</span>
        </div>

        <button type="button" onClick={onHome} className="toolbar-button" title="Home">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/>
          </svg>
          <span className="hidden lg:inline">Home</span>
        </button>

        <button
          type="button"
          onClick={onDeleteSandbox}
          disabled={deletingSandbox}
          className="toolbar-button toolbar-button-danger"
          title="Permanently delete project and sandbox data"
          aria-label="Permanently delete project and sandbox data"
        >
          {deletingSandbox ? (
            <span className="button-spinner" aria-hidden="true" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16"/><path d="M9 3h6l1 4H8l1-4Z"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>
            </svg>
          )}
          <span className="hidden lg:inline">{deletingSandbox ? 'Deleting…' : 'Delete project'}</span>
        </button>
      </div>
    </header>
  )
}
