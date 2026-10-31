import { Router } from "express";
import agent from "../agents/code.agent.js";

const agentRouter = Router();

const getPublicAgentError = (error) => {
    const statusCode = Number(error?.statusCode ?? error?.response?.status);
    const message = String(error?.message ?? '');

    if (statusCode === 401 || statusCode === 403) {
        return 'All configured AI providers rejected the request. Check provider API keys and permissions';
    }

    if (statusCode === 429) {
        return 'All configured AI providers reached their free-tier limits. Please retry after the provider quotas reset';
    }

    if ([500, 502, 503, 504].includes(statusCode)) {
        return 'All configured AI providers are temporarily unavailable after automatic retries. Please retry shortly';
    }

    return 'AI request failed after trying Gemini, Groq, and OpenRouter';
};

agentRouter.post("/invoke", async (req, res) => {
    const { message, projectId } = req.body;

    if (!message?.trim() || !projectId) {
        return res.status(400).json({ error: 'message and projectId are required' });
    }

    const startStream = () => {
        if (res.headersSent) return;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();
    };

    const writer = (text) => {
        if (res.destroyed || res.writableEnded) return;
        startStream();
        res.write(text);
    };

    const abortController = new AbortController();
    const stopOnDisconnect = () => abortController.abort();
    req.once('aborted', stopOnDisconnect);
    res.once('close', stopOnDisconnect);

    startStream();
    res.write(': connected\n\n');

    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(': keepalive\n\n');
        }
    }, 10_000);

    try {
        const stream = await agent.stream(
            { messages: [ { role: "user", content: message } ] },
            {
                context: { projectId, writer },
                streamMode: "values",
                signal: abortController.signal
            }
        );

        let lastState = null;
        for await (const state of stream) {
            lastState = state;
        }

        if (lastState?.messages?.length) {
            startStream();
            const msgs = lastState.messages;
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                const role = m.role ?? m._getType?.();
                if ((role === 'ai' || role === 'assistant') && !m.tool_calls?.length) {
                    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                    res.write(content + '\n');
                    break;
                }
            }
        }

        startStream();
        res.end();
    } catch (error) {
        console.error("Error invoking agent:", error);
        if (!res.destroyed && !res.writableEnded) {
            res.write(`Error: ${getPublicAgentError(error)}\n`);
            res.end();
        }
    } finally {
        clearInterval(heartbeat);
        req.off('aborted', stopOnDisconnect);
        res.off('close', stopOnDisconnect);
    }
});

export default agentRouter;
