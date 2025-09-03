import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// api/chat.js
// Node runtime with robust SSE piping + clear errors to client.

// === Small helpers ===
function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}


// === Firebase Admin Init (Step 2.1) ===
// Reads credentials from FIREBASE_SERVICE_ACCOUNT (JSON string) and optional FIREBASE_PROJECT_ID.
// NOTE: Never commit service account JSON. Use env vars in Vercel/local .env.
let _adminReady = false;

function initAdmin() {
  if (_adminReady) return true;

  // If an app is already initialized, reuse it.
  if (getApps().length) {
    _adminReady = true;
    return true;
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!json) {
    console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT not set; Firestore reads disabled');
    return false;
  }

  let creds;
  try {
    creds = JSON.parse(json);
    // Convert escaped newlines (\\n) from .env into real newlines for the key
    if (creds.private_key && typeof creds.private_key === 'string' && creds.private_key.includes('\\n')) {
      creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    }
  } catch (e) {
    console.error('[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
    return false;
  }

  initializeApp({
    credential: cert(creds),
    projectId: projectId || creds.project_id,
  });

  _adminReady = true;
  return true;
}

function getDb() {
  const ok = initAdmin();
  return ok ? getFirestore(getApp()) : null;
}

// === Firestore Readers (Step 2.1) ===
// Lightweight 90s in-memory cache for hot paths
const _cache = { biz: new Map(), kb: new Map() };
const CACHE_TTL_MS = 90_000;
function _get(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.t > v.ttl) { map.delete(key); return null; }
  return v.val;
}
function _set(map, key, val, ttl = CACHE_TTL_MS) {
  map.set(key, { val, t: Date.now(), ttl });
}

/* --- business doc (minimal fields) --- */
async function fetchBiz(bizId) {
  const cached = _get(_cache.biz, bizId);
  if (cached) return cached;
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection('businesses').doc(bizId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const result = {
    name: data.name || bizId,
    services: Array.isArray(data.services) ? data.services : [],
    calendlyUrl: data.calendlyUrl || null,
    logoUrl: data.logoUrl || null,
  };
  _set(_cache.biz, bizId, result);
  return result;
}

/* --- knowledge base chunks (subset of fields) --- */
async function fetchKb(bizId) {
  const cached = _get(_cache.kb, bizId);
  if (cached) return cached;
  const db = getDb();
  if (!db) return [];
  const col = db.collection('businesses').doc(bizId).collection('kb_chunks');
  const snap = await col.get();
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    rows.push({
      id: doc.id,
      text: d.text || '',
      source: d.source || '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      embedding: Array.isArray(d.embedding) ? d.embedding : [],
      updatedAt: d.updatedAt || null,
    });
  });
  _set(_cache.kb, bizId, rows);
  return rows;
}

// === Main handler ===
export default async function handler(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  try {
    // --- Read JSON body (Node) ---
    const bodyStr = await new Promise((resolve, reject) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    let parsed;
    try {
      parsed = JSON.parse(bodyStr || '{}');
    } catch {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }

const { bizId, messages, traceId, debug } = parsed;

if (!bizId || !Array.isArray(messages)) {
  res.statusCode = 400;
  res.setHeader('content-type', 'application/json');
  return res.end(JSON.stringify({ error: 'Invalid payload. Expect { bizId, messages[] }.' }));
}

// --- Optional debug path: verify Firestore Admin connectivity ---
if (debug === 'kb') {
  try {
    const biz = await fetchBiz(bizId);
    const kb = await fetchKb(bizId);

    // SSE headers
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    setCORS(res);

    res.write(sse({ type: 'ready', traceId: traceId || null }));
    res.write(sse({
      type: 'info',
      message: 'Admin OK',
      biz: biz ? { name: biz.name, calendlyUrl: biz.calendlyUrl || null } : null,
      kbCount: Array.isArray(kb) ? kb.length : 0
    }));
    res.write(sse({ type: 'done' }));
    return; // IMPORTANT: stop here for debug path
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'KB debug failed', detail: e?.message || String(e) }));
  }
}

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'Server not configured: missing OPENAI_API_KEY.' }));
    }
    const model = process.env.MODEL_NAME || 'gpt-4o-mini';

    // System prompt (RAG comes in Step 2)
    const sys = {
      role: 'system',
      content:
        `You are a concise assistant in a business card app. Keep replies short; don’t invent facts. ` +
        `If booking is requested and a Calendly link exists in context, include it. Tenant: ${bizId}.`,
    };

    // --- Call OpenAI with streaming ---
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.2,
        messages: [sys, ...messages],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'Upstream error', detail: detail || upstream.status }));
    }

    // --- Prepare SSE response ---
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    setCORS(res);

    res.write(sse({ type: 'ready', traceId: traceId || null }));

    const decoder = new TextDecoder();
    let buf = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let closed = false;

    const hardStop = setTimeout(() => {
      if (!closed) {
        res.write(sse({ type: 'error', message: 'Upstream timeout' }));
        res.end();
        closed = true;
      }
    }, 60_000);

    // --- Transform OpenAI SSE -> our SSE ---
    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });
      buf += text;

      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);

        line = line.trimEnd();
        if (!line || !line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload) continue;

        if (payload === '[DONE]') {
          res.write(sse({ type: 'done', usage: { prompt: promptTokens, completion: completionTokens } }));
          clearTimeout(hardStop);
          res.end();
          closed = true;
          return;
        }

        try {
          const json = JSON.parse(payload);

          if (json.usage) {
            promptTokens = json.usage.prompt_tokens ?? promptTokens;
            completionTokens = json.usage.completion_tokens ?? completionTokens;
          }

          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) res.write(sse({ type: 'chunk', delta }));
        } catch {
          // ignore keep-alives
        }
      }
    }

    if (!closed) {
      clearTimeout(hardStop);
      res.write(sse({ type: 'done', usage: { prompt: promptTokens, completion: completionTokens } }));
      res.end();
      closed = true;
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Unexpected server error' }));
  }
}
