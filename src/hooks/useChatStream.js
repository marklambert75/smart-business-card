// src/hooks/useChatStream.js
import { useRef, useState, useCallback } from 'react';

// Public API: const { send, abort, isLoading, text } = useChatStream();

export function useChatStream() {
  const [isLoading, setIsLoading] = useState(false);
  const [text, setText] = useState('');
  const abortRef = useRef(null);

  // Internal: split incoming stream by lines and dispatch "data:" frames
  const pushLine = (bufRef, chunk, onLine) => {
    bufRef.current += chunk;
    let idx;
    while ((idx = bufRef.current.indexOf('\n')) >= 0) {
      const line = bufRef.current.slice(0, idx).trimEnd();
      bufRef.current = bufRef.current.slice(idx + 1);
      if (line) onLine(line);
    }
  };

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
    setText(''); // clear partial stream in UI when user stops
  }, []);

  const send = useCallback(
    async ({ bizId, messages, onChunk, onDone, onError }) => {
      if (!bizId || !Array.isArray(messages)) {
        onError?.(new Error('Invalid payload: { bizId, messages[] } required.'));
        return;
      }

      // Cancel any in-flight request and reset
      abort();

      setIsLoading(true);
      setText('');
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bizId, messages }),
          signal: ctrl.signal,
        });

        // If the server returned a JSON error (non-SSE), surface it clearly
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.startsWith('text/event-stream')) {
          let detail = '';
          try {
            detail = await res.text();
          } catch {}
          let msg = `Request failed (${res.status})`;
          try {
            const j = JSON.parse(detail);
            if (j.error) msg = `${msg}: ${j.error}${j.detail ? ` — ${j.detail}` : ''}`;
          } catch {
            if (detail) msg = `${msg}: ${detail}`;
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const bufRef = { current: '' };

        const handleLine = (line) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (!payload) return;

          try {
            const evt = JSON.parse(payload);

            if (evt.type === 'chunk' && typeof evt.delta === 'string') {
              setText((prev) => {
                const next = prev + evt.delta;
                onChunk?.(evt.delta, next);
                return next;
              });
              return;
            }

            if (evt.type === 'done') {
              setIsLoading(false);
              abortRef.current = null;
              onDone?.(evt.usage || null);
              return;
            }

            if (evt.type === 'error') {
              throw new Error(evt.message || 'Stream error');
            }
          } catch {
            // ignore malformed lines
          }
        };

        // Read the stream
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          pushLine(bufRef, chunkText, handleLine);
        }

        setIsLoading(false);
        abortRef.current = null;
        onDone?.(null);
      } catch (err) {
        setIsLoading(false);
        abortRef.current = null;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [abort]
  );

  return { send, abort, isLoading, text };
}
