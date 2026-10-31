import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { io } from 'socket.io-client'
import { sandboxHost } from '../lib/sandboxHosts'

export default function Terminal({ sandboxId }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  const initTerminal = useCallback(() => {
    if (!containerRef.current || termRef.current) return

    const term = new XTerm({
      theme: {
        background: '#090a0d',
        foreground: '#d4d7dc',
        cursor: '#e09f3e',
        cursorAccent: '#090a0d',
        selectionBackground: 'rgba(224,159,62,0.24)',
        black: '#1e2d45',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a78bfa',
        cyan: '#5fa8d3',
        white: '#e2e8f0',
        brightBlack: '#334155',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    term.writeln('\x1b[38;5;244mAttaching to /workspace shell…\x1b[0m')

    return term
  }, [])

  const connectSocket = useCallback((term) => {
    if (!sandboxId || !term) return

    const agentHost = sandboxHost(sandboxId, 'agent')

    try {
      const socket = io(agentHost, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        setConnected(true)
        setError(null)
      })

      socket.on('disconnect', () => {
        setConnected(false)
        term.writeln('\r\n\x1b[33m⚠ Disconnected. Reconnecting...\x1b[0m')
      })

      socket.on('connect_error', (err) => {
        setConnected(false)
        setError('Connection failed')
        term.writeln(`\r\n\x1b[31m✗ Connection error: ${err.message}\x1b[0m`)
      })

      socket.on('terminal-output', (data) => {
        term.write(data)
      })

      term.onData((data) => {
        socket.emit('terminal-input', data)
      })

    } catch (err) {
      setError(err.message)
    }
  }, [sandboxId])

  useEffect(() => {
    const term = initTerminal()
    const connectTimer = term ? window.setTimeout(() => connectSocket(term), 0) : null

    return () => {
      if (connectTimer) window.clearTimeout(connectTimer)
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null }
      if (termRef.current) { termRef.current.dispose(); termRef.current = null }
    }
  }, [initTerminal, connectSocket])

  // Handle resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit()
        } catch {
          // The terminal can be between mount and disposal during rapid layout changes.
        }
      }
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex flex-col h-full"
      style={{ background: '#090a0d' }}>

      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-3 shrink-0"
        style={{ height: '32px', background: '#101116', borderBottom: '1px solid #262a32' }}>
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          <span className="text-xs font-medium" style={{ color: '#9ca3af' }}>Terminal</span>
          <span className="text-[10px] font-mono" style={{ color: '#555b66' }}>bash — /workspace</span>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs" style={{ color: '#ef4444' }}>{error}</span>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full"
              style={{ background: connected ? '#10b981' : '#ef4444', boxShadow: `0 0 6px ${connected ? '#10b981' : '#ef4444'}` }} />
            <span className="text-xs" style={{ color: '#475569' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* xterm container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
