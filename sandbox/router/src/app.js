import express from 'express';
import morgan from 'morgan';
import { createProxyMiddleware } from "http-proxy-middleware";
import http from 'http';
import { createProxyServer } from 'httpxy';
import { refreshTTL } from './config/redis.js';

const app = express();
app.use(morgan('combined'));

app.get('/api/status/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
})

app.get('/api/status/readyz', (req, res) => {
    res.status(200).json({ status: 'ready' });
})

const proxies = {}
const agentProxies = {}
const sandboxIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sandboxFromHost(rawHost) {
    const host = String(rawHost || '').split(':')[0].toLowerCase();
    const flat = host.match(/^(agent|preview)-([0-9a-f-]+)\.projectrs\.me$/);
    if (flat && sandboxIdPattern.test(flat[2])) return { type: flat[1], sandboxId: flat[2] };

    const legacy = host.match(/^([0-9a-f-]+)\.(agent|preview)\.projectrs\.me$/);
    if (legacy && sandboxIdPattern.test(legacy[1])) return { type: legacy[2], sandboxId: legacy[1] };

    return null;
}

function getProxy(sandboxId) {
    const target = `http://sandbox-service-${sandboxId}`;
    if (!proxies[ sandboxId ]) {
        proxies[ sandboxId ] = createProxyMiddleware({
            target,
            changeOrigin: true,
        });
    }
    return proxies[ sandboxId ];
}

function getAgentProxy(sandboxId) {
    const target = `http://sandbox-service-${sandboxId}:3000`;
    if (!agentProxies[ sandboxId ]) {
        agentProxies[ sandboxId ] = createProxyMiddleware({
            target,
            changeOrigin: true,
        });
    }
    return agentProxies[ sandboxId ];
}

// Single httpxy proxy server for all WebSocket upgrades
const wsProxy = createProxyServer({ changeOrigin: true });
wsProxy.on('error', (err, req, socket) => {
    console.error('WS proxy error:', err.message);
    socket?.destroy();
});

app.use(async (req, res, next) => {
    const destination = sandboxFromHost(req.headers.host);
    if (!destination) return res.status(404).json({ message: 'Sandbox host not found' });
    const { sandboxId, type } = destination;

    await refreshTTL(sandboxId);

    if (type === 'agent') {
        return getAgentProxy(sandboxId)(req, res, next);
    } else if (type === 'preview') {
        return getProxy(sandboxId)(req, res, next);
    }
});

// Create the HTTP server explicitly
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
    const destination = sandboxFromHost(req.headers.host);
    if (!destination) { socket.destroy(); return; }

    // Prevent EPIPE and connection-reset errors from crashing the process
    // during the active piped session (after ws() Promise has resolved)
    socket.on('error', () => socket.destroy());

    const { sandboxId, type } = destination;

    console.log(`WS upgrade request: ${req.headers.host}, sandboxId: ${sandboxId}, type: ${type}`);

    if (type === 'agent') {
        wsProxy.ws(req, socket, { target: `http://sandbox-service-${sandboxId}:3000` }, head)
            .catch(() => socket.destroy());
    } else if (type === 'preview') {
        wsProxy.ws(req, socket, { target: `http://sandbox-service-${sandboxId}` }, head)
            .catch(() => socket.destroy());
    } else {
        socket.destroy();
    }
});

export default server; // export server, not app
