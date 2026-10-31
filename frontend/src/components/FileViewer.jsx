import { useEffect, useMemo, useState } from 'react'
import Prism from 'prismjs'
import 'prismjs/themes/prism-tomorrow.css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'

const LANGUAGE_MAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx', css: 'css', html: 'markup', svg: 'markup',
  json: 'json', md: 'markdown', py: 'python', sh: 'bash',
  yml: 'yaml', yaml: 'yaml'
}

function getLanguage(filename) {
  if (filename?.toLowerCase().endsWith('dockerfile')) return 'bash'
  const extension = filename?.split('.').pop()?.toLowerCase()
  return LANGUAGE_MAP[extension] || 'plaintext'
}

export default function FileViewer({ agentBase, filePath }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const language = getLanguage(filePath)

  useEffect(() => {
    if (!agentBase || !filePath) return
    const controller = new AbortController()
    const fetchFile = async () => {
      setLoading(true)
      setError('')
      setContent(null)
      try {
        const response = await fetch(`${agentBase}/read-files?files=${encodeURIComponent(filePath)}`, {
          signal: controller.signal
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || `Unable to read file (${response.status})`)
        const fileData = data.files?.[0]
        if (!fileData) throw new Error('File is empty or unavailable')
        setContent(String(Object.values(fileData)[0] ?? ''))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'Unable to load file')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    fetchFile()
    return () => controller.abort()
  }, [agentBase, filePath])

  const highlightedLines = useMemo(() => {
    if (content === null) return []
    const grammar = Prism.languages[language] || Prism.languages.plaintext
    return Prism.highlight(content, grammar, language).split('\n')
  }, [content, language])

  const copyContent = async () => {
    if (content === null) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  if (!filePath) {
    return (
      <div className="editor-empty h-full flex flex-col items-center justify-center gap-3">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>
        </svg>
        <p>Select a file from Explorer</p>
        <span>Its source will open here with syntax highlighting.</span>
      </div>
    )
  }

  const parts = filePath.split('/')
  const filename = parts.at(-1)

  return (
    <div className="code-editor flex flex-col h-full">
      <div className="editor-tabs shrink-0 flex items-end">
        <div className="editor-tab is-active flex items-center gap-2">
          <span className={`file-type file-type-${language}`}>{language === 'javascript' || language === 'jsx' ? 'JS' : language.slice(0, 2).toUpperCase()}</span>
          <span>{filename}</span>
          <span className="tab-close" aria-hidden="true">×</span>
        </div>
      </div>

      <div className="editor-toolbar shrink-0 flex items-center justify-between px-3">
        <div className="editor-breadcrumbs flex items-center min-w-0" aria-label="File path">
          {parts.map((part, index) => (
            <span key={`${part}-${index}`} className="flex items-center min-w-0">
              {index > 0 && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>}
              <span className="truncate">{part}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="editor-language">{language}</span>
          <button type="button" onClick={copyContent} className="editor-copy-button" disabled={content === null}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11"/><path d="M5 15H4V4h11v1"/></svg>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="editor-body flex-1 overflow-auto relative" aria-busy={loading}>
        {loading && <div className="editor-loading"><span className="button-spinner" /> Loading {filename}</div>}
        {error && <div className="editor-error" role="alert">{error}</div>}
        {content !== null && !loading && (
          <div className="code-lines min-w-max py-2" role="region" aria-label={`${filename} source code`}>
            {highlightedLines.map((line, index) => (
              <div className="code-line" key={index}>
                <span className="line-number" aria-hidden="true">{index + 1}</span>
                <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="editor-statusbar shrink-0 flex items-center justify-end gap-4 px-3">
        <span>Ln 1, Col 1</span><span>Spaces: 2</span><span>UTF-8</span><span>{language}</span>
      </div>
    </div>
  )
}
