'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { decodeConfig, decryptFromUrl, defaultKeyPresets } = require('./lib/decryptor');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const KEYS_FILE = path.join(__dirname, 'keys', 'custom-keys.json');
const TOKEN = (process.env.ACCESS_TOKEN || '').trim();
const hits = new Map();

function ip(r) {
  return (r.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || r.socket.remoteAddress || 'unknown';
}
function rl(a) {
  const n = Date.now();
  const w = hits.get(a);
  if (!w || n > w.t) { hits.set(a, { c: 1, t: n + 60000 }); return true; }
  w.c++;
  return w.c <= 60;
}
function snd(res, st, d, tp) {
  const b = typeof d === 'string' ? d : JSON.stringify(d, null, 2);
  res.writeHead(st, {
    'Content-Type': tp || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Access-Token',
    'Cache-Control': 'no-store'
  });
  res.end(b);
}
function body(req) {
  return new Promise((ok, no) => {
    const c = [];
    let s = 0;
    req.on('data', d => {
      s += d.length;
      if (s > 4 * 1024 * 1024) { no(new Error('body too large')); req.destroy(); return; }
      c.push(d);
    });
    req.on('end', () => ok(Buffer.concat(c)));
    req.on('error', no);
  });
}
function auth(req) {
  if (!TOKEN) return true;
  const b = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const x = (req.headers['x-access-token'] || '').trim();
  const u = new URL(req.url, 'http://localhost');
  const q = (u.searchParams.get('token') || '').trim();
  return b === TOKEN || x === TOKEN || q === TOKEN;
}
function staticFile(req, res) {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUBLIC, u));
  if (!f.startsWith(PUBLIC)) return snd(res, 403, { ok: false });
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return snd(res, 404, { ok: false });
  const e = path.extname(f).toLowerCase();
  const tp = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': tp[e] || 'application/octet-stream', 'Cache-Control': e === '.html' ? 'no-cache' : 'public,max-age=3600' });
  fs.createReadStream(f).pipe(res);
}

function pureText(r) {
  // 直接明文优先：已解析 JSON 用美化；直播源用原文；否则 text
  if (r && r.normalized && typeof r.normalized === 'object' && !r.normalized._rawLive) {
    return JSON.stringify(r.normalized, null, 2);
  }
  if (r && r.json && typeof r.json === 'object' && !r.json._rawLive) {
    return JSON.stringify(r.json, null, 2);
  }
  if (r && typeof r.text === 'string' && r.text.trim()) return r.text;
  if (r && r.error) return r.error;
  return '';
}

async function doDecrypt(p) {
  const ek = Array.isArray(p.keys) ? p.keys : [];
  const opts = {
    customKeysPath: KEYS_FILE,
    extraKeys: ek,
    timeoutMs: Math.min(Number(p.timeoutMs || 25000), 45000)
  };
  let r;
  if (p.url) {
    if (!/^https?:\/\//i.test(p.url)) throw Object.assign(new Error('URL 必须以 http:// 或 https:// 开头'), { code: 400 });
    r = await decryptFromUrl(String(p.url).trim(), opts);
  } else if (typeof p.content === 'string') {
    r = decodeConfig(p.content, Object.assign({}, opts, { baseUrl: p.baseUrl || '' }));
  } else {
    throw Object.assign(new Error('请提供 url 或 content'), { code: 400 });
  }
  const text = pureText(r);
  return {
    ok: !!r.ok,
    mode: r.mode,
    algorithm: r.algorithm || null,
    keyName: r.keyName || null,
    encoding: r.encoding || null,
    score: r.score || 0,
    contentKind: r.contentKind || null,
    source: r.source || null,
    pureResult: text,          // 纯明文
    text: text,                // 同 pureResult，方便直接取
    json: (r.normalized && !r.normalized._rawLive) ? r.normalized : (r.json && !r.json._rawLive ? r.json : null),
    attempts: r.attempts || [],
    formatsTried: r.formatsTried || [],
    linked: r.linked || null,
    error: r.ok ? null : (r.error || r.text || '解密失败')
  };
}

const srv = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return snd(res, 204, '');
    if (!rl(ip(req))) return snd(res, 429, { ok: false, error: 'too many requests' });
    const u = new URL(req.url || '/', 'http://localhost');
    const pn = u.pathname;

    if (req.method === 'GET' && pn === '/api/health') {
      return snd(res, 200, { ok: true, v: '2.3', keys: defaultKeyPresets().length, auth: !!TOKEN });
    }

    // GET /api/decrypt?url=...  直接返回 JSON（含 pureResult 明文）
    // GET /api/raw?url=...      只返回纯文本明文（像 tools.v1.mk 一样直接看内容）
    if (req.method === 'GET' && (pn === '/api/decrypt' || pn === '/api/raw' || pn === '/api/jiemi')) {
      if (!auth(req)) return snd(res, 401, { ok: false, error: 'unauthorized' });
      const url = (u.searchParams.get('url') || '').trim();
      const content = u.searchParams.get('content');
      try {
        const out = await doDecrypt({ url: url || undefined, content: content != null ? content : undefined });
        if (pn === '/api/raw') {
          return snd(res, 200, out.pureResult || out.error || '', 'text/plain; charset=utf-8');
        }
        return snd(res, 200, out);
      } catch (e) {
        if (pn === '/api/raw') return snd(res, 200, e.message || String(e), 'text/plain; charset=utf-8');
        return snd(res, e.code || 200, { ok: false, error: e.message || String(e), mode: 'fetch-error' });
      }
    }

    if (req.method === 'POST' && pn === '/api/decrypt') {
      if (!auth(req)) return snd(res, 401, { ok: false, error: 'unauthorized' });
      const raw = await body(req);
      let p = {};
      try { p = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) {
        return snd(res, 400, { ok: false, error: 'json required' });
      }
      try {
        const out = await doDecrypt(p);
        return snd(res, 200, out);
      } catch (e) {
        return snd(res, e.code || 200, { ok: false, error: e.message || String(e), mode: 'fetch-error' });
      }
    }

    if (req.method === 'GET') return staticFile(req, res);
    return snd(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return snd(res, 200, { ok: false, error: e.message || String(e), mode: 'server-error' });
  }
});

srv.listen(PORT, HOST, () => console.log('TVBox Jiemi v2.3 on http://' + HOST + ':' + PORT));
