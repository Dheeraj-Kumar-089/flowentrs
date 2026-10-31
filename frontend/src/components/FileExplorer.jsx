import { useCallback, useEffect, useState } from 'react'

const TYPE_LABELS = {
  jsx: ['JS', '#61dafb'], tsx: ['TS', '#3178c6'], js: ['JS', '#f7df1e'], ts: ['TS', '#3178c6'],
  css: ['#', '#42a5f5'], html: ['<>', '#e44d26'], json: ['{}', '#d6d6d6'], md: ['M↓', '#8a8f9d'],
  svg: ['◇', '#ffb13b'], png: ['▧', '#a78bfa'], jpg: ['▧', '#a78bfa'], yml: ['Y', '#ef4444'], yaml: ['Y', '#ef4444']
}

function FileType({ filename }) {
  const extension = filename.split('.').pop()?.toLowerCase()
  const [label, color] = TYPE_LABELS[extension] || ['·', '#6b7280']
  return <span className="file-tree-type" style={{ color }} aria-hidden="true">{label}</span>
}

function buildTree(files) {
  const root = {}
  for (const filePath of files) {
    const parts = filePath.split('/').filter(Boolean)
    let node = root
    parts.forEach((part, index) => {
      if (!(part in node)) node[part] = index === parts.length - 1 ? null : {}
      if (index < parts.length - 1) node = node[part]
    })
  }
  return root
}

const sortEntries = entries => entries.sort(([, a], [, b]) => {
  const aDirectory = a !== null && typeof a === 'object'
  const bDirectory = b !== null && typeof b === 'object'
  return Number(bDirectory) - Number(aDirectory)
})

function TreeNode({ name, node, depth, activeFile, onFileSelect, parentPath }) {
  const [open, setOpen] = useState(depth < 2)
  const directory = node !== null && typeof node === 'object'
  const fullPath = parentPath ? `${parentPath}/${name}` : name
  const active = activeFile === fullPath

  if (directory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="file-tree-row directory-row"
          style={{ paddingLeft: `${8 + depth * 13}px` }}
          aria-expanded={open}
        >
          <svg className={`tree-chevron ${open ? 'is-open' : ''}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/></svg>
          <span className="truncate">{name}</span>
        </button>
        {open && sortEntries(Object.entries(node)).map(([childName, childNode]) => (
          <TreeNode key={childName} name={childName} node={childNode} depth={depth + 1}
            activeFile={activeFile} onFileSelect={onFileSelect} parentPath={fullPath} />
        ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onFileSelect(fullPath)}
      className={`file-tree-row file-row ${active ? 'is-active' : ''}`}
      style={{ paddingLeft: `${21 + depth * 13}px` }}
      aria-current={active ? 'page' : undefined}
      title={fullPath}
    >
      <FileType filename={name} />
      <span className="truncate">{name}</span>
    </button>
  )
}

export default function FileExplorer({ agentBase, activeFile, onFileSelect, refreshKey }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchFiles = useCallback(async () => {
    if (!agentBase) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${agentBase}/list-files`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || `Unable to list files (${response.status})`)
      setFiles(data.files || [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to load files')
    } finally {
      setLoading(false)
    }
  }, [agentBase])

  useEffect(() => {
    const timer = window.setTimeout(fetchFiles, 0)
    return () => window.clearTimeout(timer)
  }, [fetchFiles, refreshKey])
  const tree = buildTree(files)

  return (
    <aside className="file-explorer flex flex-col h-full shrink-0">
      <div className="panel-header flex items-center justify-between px-3 shrink-0">
        <div><span>Explorer</span><small>Workspace</small></div>
        <button type="button" onClick={fetchFiles} className="icon-button" title="Refresh files" aria-label="Refresh files">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></svg>
        </button>
      </div>

      <div className="file-tree flex-1 overflow-y-auto py-1" aria-busy={loading}>
        {loading ? (
          <div className="panel-state"><span className="button-spinner" /> Loading files</div>
        ) : error ? (
          <div className="panel-state panel-error"><span>{error}</span><button type="button" onClick={fetchFiles}>Retry</button></div>
        ) : sortEntries(Object.entries(tree)).map(([name, node]) => (
          <TreeNode key={name} name={name} node={node} depth={0} activeFile={activeFile} onFileSelect={onFileSelect} parentPath="" />
        ))}
      </div>

      <div className="panel-footer px-3 shrink-0">{files.length} files</div>
    </aside>
  )
}
