'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');

function stripBom(s) { return String(s || '').replace(/^\uFEFF/, ''); }
function isProbablyJson(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.trim();
  return (s.startsWith('{') && s.includes('}')) || (s.startsWith('[') && s.includes(']'));
}
function extractJsonBlock(t) {
  if (!t) return null;
  const m = String(t).match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}
function stripJsonNoise(s) {
  return String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
}
function tryParseJson(text) {
  const c = [];
  if (text != null) c.push(String(text));
  const b = extractJsonBlock(text);
  if (b) c.push(b);
  for (const s of c) {
    try { return JSON.parse(s); } catch (_) {}
    try { return JSON.parse(stripJsonNoise(s)); } catch (_) {}
  }
  return null;
}
function looksLikeHex(s) {
  const t = String(s || '').replace(/\s+/g, '');
  return t.length >= 16 && t.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(t);
}
function looksLikeBase64(s) {
  const t = String(s || '').replace(/\s+/g, '');
  return t.length >= 16 && t.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}
function looksLikeBase64Url(s) {
  const t = String(s || '').replace(/\s+/g, '');
  return t.length >= 16 && /^[A-Za-z0-9\-_]+={0,2}$/.test(t) && /[-_]/.test(t);
}
function padKey(k, size) {
  const b = Buffer.from(String(k || ''), 'utf8');
  if (b.length === size) return b;
  if (b.length > size) return b.subarray(0, size);
  const o = Buffer.alloc(size, 0);
  b.copy(o);
  return o;
}
function normalizeKey(raw, size) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (looksLikeHex(s) && s.replace(/\s+/g, '').length === size * 2) {
    return Buffer.from(s.replace(/\s+/g, ''), 'hex');
  }
  try {
    if (looksLikeBase64(s)) {
      const b = Buffer.from(s, 'base64');
      if (b.length === size) return b;
    }
  } catch (_) {}
  return padKey(s, size);
}
function safeDecrypt(alg, key, iv, data, autoPadding) {
  try {
    const d = crypto.createDecipheriv(alg, key, iv || null);
    d.setAutoPadding(autoPadding);
    return Buffer.concat([d.update(data), d.final()]);
  } catch (_) {
    return null;
  }
}
function tryGunzip(b) { try { return zlib.gunzipSync(b); } catch (_) { return null; } }
function tryInflate(b) {
  try { return zlib.inflateSync(b); } catch (_) {
    try { return zlib.inflateRawSync(b); } catch (_) {
      try { return zlib.unzipSync(b); } catch (_) { return null; }
    }
  }
}
function bufferToText(buf) {
  if (!buf) return '';
  let t = buf.toString('utf8');
  if (/\x00/.test(t.slice(0, 80))) t = buf.toString('latin1');
  return stripBom(t);
}
function isHtml(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml') || t.includes('<head>') || t.includes('<body');
}
function b64urlToBuf(s) {
  let t = String(s || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64');
}
function rot13(s) {
  return String(s).replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function reverseText(s) { return String(s).split('').reverse().join(''); }
function stripKnownMarkers(s) {
  let t = String(s || '').trim();
  // common TVBox cipher wrappers
  const markers = [
    /^#!@#!@/,
    /^#!@/,
    /^@#@/,
    /^\*\*\*/,
    /^===/,
    /^###/,
    /^ENC:/i,
    /^AES:/i,
    /^BASE64:/i,
    /^HEX:/i,
    /^2423/,
    /^0x/i
  ];
  for (const re of markers) t = t.replace(re, '');
  // sometimes quotes wrap whole cipher
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  return t.trim();
}

function candidateBuffers(input) {
  const list = [];
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8');
  list.push({ l: 'raw', b: raw });

  let text = stripBom(raw.toString('utf8')).trim();
  const stripped = stripKnownMarkers(text);
  if (stripped && stripped !== text) {
    list.push({ l: 'marker-stripped', b: Buffer.from(stripped, 'utf8') });
    text = stripped;
  }

  // URI decode
  try {
    if (/%[0-9a-fA-F]{2}/.test(text)) {
      const u = decodeURIComponent(text);
      list.push({ l: 'uri', b: Buffer.from(u, 'utf8') });
    }
  } catch (_) {}

  // reverse / rot13 on text layer
  list.push({ l: 'reverse', b: Buffer.from(reverseText(text), 'utf8') });
  list.push({ l: 'rot13', b: Buffer.from(rot13(text), 'utf8') });

  const compact = text.replace(/\s+/g, '');
  if (looksLikeHex(compact)) {
    try { list.push({ l: 'hex', b: Buffer.from(compact, 'hex') }); } catch (_) {}
  }
  if (looksLikeBase64(compact)) {
    try { list.push({ l: 'b64', b: Buffer.from(compact, 'base64') }); } catch (_) {}
  }
  if (looksLikeBase64Url(compact)) {
    try { list.push({ l: 'b64url', b: b64urlToBuf(compact) }); } catch (_) {}
  }
  if (compact.toLowerCase().startsWith('2423') && looksLikeHex(compact.slice(4))) {
    try { list.push({ l: 'hex-2423', b: Buffer.from(compact.slice(4), 'hex') }); } catch (_) {}
  }
  if (compact.toLowerCase().startsWith('0x') && looksLikeHex(compact.slice(2))) {
    try { list.push({ l: 'hex-0x', b: Buffer.from(compact.slice(2), 'hex') }); } catch (_) {}
  }

  // nested decode layers
  for (const it of [...list]) {
    const s = it.b.toString('utf8').trim().replace(/\s+/g, '');
    if (looksLikeBase64(s)) {
      try { list.push({ l: it.l + '>b64', b: Buffer.from(s, 'base64') }); } catch (_) {}
    }
    if (looksLikeBase64Url(s)) {
      try { list.push({ l: it.l + '>b64u', b: b64urlToBuf(s) }); } catch (_) {}
    }
    if (looksLikeHex(s)) {
      try { list.push({ l: it.l + '>hex', b: Buffer.from(s, 'hex') }); } catch (_) {}
    }
  }

  // compression
  for (const it of [...list]) {
    const g = tryGunzip(it.b);
    if (g) list.push({ l: it.l + '>gzip', b: g });
    const i = tryInflate(it.b);
    if (i) list.push({ l: it.l + '>inflate', b: i });
  }

  // unique
  const seen = new Set();
  return list.filter((x) => {
    const h = crypto.createHash('sha1').update(x.b).digest('hex');
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  }).slice(0, 120);
}

function defaultKeys() {
  // public community presets frequently shared for TVBox configs
  return [
    { n: 'aes1', k: '1234567890123456', i: '1234567890123456', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes2', k: 'abcdefghijklmnop', i: 'abcdefghijklmnop', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes3', k: '0123456789abcdef', i: '0123456789abcdef', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes4', k: 'qwertyuiopasdfgh', i: 'qwertyuiopasdfgh', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes5', k: 'TEDUapp@2021KEY!', i: 'TEDUapp@2021_IV!', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes6', k: 'baifuhexiaoqiao.', i: 'baifuhexiaoqiao.', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes7', k: 'http://mkjx.top/', i: 'http://mkjx.top/', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes8', k: 'okx123456okx5678', i: 'okx123456okx5678', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes9', k: 'haierwangyi12345', i: 'haierwangyi12345', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes10', k: 'MaMaMiYa12345678', i: 'MaMaMiYa12345678', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes11', k: 'llbljdllxgsllblj', i: 'llbljdllxgsllblj', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes12', k: 'wangyun1234567890', i: 'wangyun1234567890', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes13', k: '5271567156715671', i: '5271567156715671', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes14', k: 'xhww202304202304', i: 'xhww202304202304', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes15', k: 'tvlive2023050501', i: 'tvlive2023050501', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes16', k: 'F789D12A3B456CDE', i: 'F789D12A3B456CDE', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes17', k: 'tvbox@goiot.xyz!', i: 'tvbox@goiot.xyz!', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes18', k: 'duotv@duotv.com!', i: 'duotv@duotv.com!', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes19', k: 'miexx1234567890!', i: 'miexx1234567890!', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes20', k: 'tb66666666666666', i: 'tb66666666666666', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes21', k: 'tvbox6666666666', i: 'tvbox6666666666', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes22', k: '1234567887654321', i: '1234567887654321', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'aes23', k: 'wuming1234567890', i: 'wuming1234567890', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes24', k: 'qiaoji2022qiaoji', i: 'qiaoji2022qiaoji', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes25', k: 'xiaoya1234567890', i: 'xiaoya1234567890', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes26', k: 'fanqie1234567890', i: 'fanqie1234567890', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes27', k: 'alipay1234567890', i: 'alipay1234567890', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes28', k: 'jsm1234567890123', i: 'jsm1234567890123', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes29', k: 'tvbox1234567890a', i: 'tvbox1234567890a', s: 16, a: ['aes-128-cbc'] },
    { n: 'aes30', k: 'ok123456ok123456', i: 'ok123456ok123456', s: 16, a: ['aes-128-cbc', 'aes-128-ecb'] },
    { n: 'a2561', k: '12345678901234567890123456789012', i: '1234567890123456', s: 32, a: ['aes-256-cbc', 'aes-256-ecb'] },
    { n: 'a2562', k: 'abcdefghijklmnopABCDEFGHIJKLMNOP', i: 'abcdefghijklmnop', s: 32, a: ['aes-256-cbc'] },
    { n: 'a2563', k: '0123456789abcdef0123456789abcdef', i: '0123456789abcdef', s: 32, a: ['aes-256-cbc'] },
    { n: 'des1', k: '12345678', i: '12345678', s: 8, a: ['des-cbc', 'des-ecb'] },
    { n: 'des2', k: 'password', i: 'password', s: 8, a: ['des-cbc', 'des-ecb'] },
    { n: 'des3', k: 'ABCDEFGH', i: 'ABCDEFGH', s: 8, a: ['des-cbc', 'des-ecb'] },
    { n: 'des4', k: 'tvbox123', i: 'tvbox123', s: 8, a: ['des-cbc', 'des-ecb'] },
    { n: '3d1', k: '123456789012345678901234', i: '12345678', s: 24, a: ['des-ede3-cbc'] },
    { n: '3d2', k: 'abcdefghijklmnopqrstuvwx', i: '12345678', s: 24, a: ['des-ede3-cbc'] },
    { n: 'xor1', k: '1234567890123456', i: '', s: 16, a: ['xor'] },
    { n: 'xor2', k: 'abcdefghijklmnop', i: '', s: 16, a: ['xor'] },
    { n: 'xor3', k: 'okx123456okx5678', i: '', s: 16, a: ['xor'] },
    { n: 'xor4', k: 'haierwangyi12345', i: '', s: 16, a: ['xor'] },
    { n: 'xor5', k: 'tvbox', i: '', s: 5, a: ['xor'] },
    { n: 'xor6', k: 'ok', i: '', s: 2, a: ['xor'] }
  ];
}

function loadCustom(fp) {
  try {
    if (!fp || !fs.existsSync(fp)) return [];
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (Array.isArray(d)) return d.map(normalizePreset);
    if (Array.isArray(d.keys)) return d.keys.map(normalizePreset);
    return [];
  } catch (_) {
    return [];
  }
}

function normalizePreset(p) {
  // accept both short and long fields
  return {
    n: p.n || p.name || 'custom',
    k: p.k || p.key || '',
    i: p.i || p.iv || '',
    s: p.s || p.keySize || 16,
    a: p.a || p.algs || ['aes-128-cbc', 'aes-128-ecb']
  };
}

function decryptWithPreset(buf, p) {
  const results = [];
  const keySize = p.s || 16;
  const key = normalizeKey(p.k, keySize);
  if (!key) return results;
  for (const alg of (p.a || [])) {
    if (alg === 'xor') {
      const x = xorDecrypt(buf, p.k);
      if (x) results.push({ alg: 'xor', buf: x });
      continue;
    }
    const needsIv = /cbc|cfb|ofb|ctr/i.test(alg) && !/ecb/i.test(alg);
    let iv = null;
    if (needsIv) {
      const ivSize = /^des/i.test(alg) ? 8 : 16;
      iv = normalizeKey(p.i || p.k, ivSize);
    }
    let out = safeDecrypt(alg, key, iv, buf, true);
    if (out) results.push({ alg: alg + '/pkcs', buf: out });
    out = safeDecrypt(alg, key, iv, buf, false);
    if (out) results.push({ alg: alg + '/none', buf: out });
    // IV from head
    if (needsIv && buf.length > 16) {
      const ivSize = /^des/i.test(alg) ? 8 : 16;
      const iv2 = buf.subarray(0, ivSize);
      out = safeDecrypt(alg, key, iv2, buf.subarray(ivSize), true);
      if (out) results.push({ alg: alg + '/ivhead', buf: out });
    }
  }
  return results;
}

function xorDecrypt(buf, keyText) {
  if (!keyText) return null;
  const key = Buffer.from(String(keyText), 'utf8');
  if (!key.length) return null;
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

function scoreText(t) {
  if (!t) return 0;
  let v = 0;
  if (tryParseJson(t)) v += 130;
  if (isProbablyJson(t)) v += 40;
  if (/"sites"\s*:/i.test(t)) v += 40;
  if (/"spider"\s*:/i.test(t)) v += 25;
  if (/"lives"\s*:/i.test(t)) v += 20;
  if (/"wallpaper"\s*:/i.test(t)) v += 10;
  if (/"parses"\s*:/i.test(t)) v += 10;
  if (/"flags"\s*:/i.test(t)) v += 5;
  if (/"jxs"\s*:/i.test(t)) v += 5;
  const sample = t.slice(0, 2000);
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 127) printable++;
  }
  v += Math.floor((printable / Math.max(sample.length, 1)) * 15);
  return v;
}

function resolveUrl(base, rel) {
  if (!rel || typeof rel !== 'string') return rel;
  const v = rel.trim();
  if (!v) return v;
  if (/^(https?:|data:|file:|clan:|proxy:)/i.test(v)) return v;
  if (v.startsWith('//')) {
    try { return new URL(base).protocol + v; } catch (_) { return 'https:' + v; }
  }
  const parts = v.split(';');
  try { parts[0] = new URL(parts[0], base).toString(); } catch (_) {}
  return parts.join(';');
}

function normalizeObj(obj, base) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  if (typeof out.spider === 'string') out.spider = resolveUrl(base, out.spider);
  if (typeof out.wallpaper === 'string' && out.wallpaper.startsWith('./')) out.wallpaper = resolveUrl(base, out.wallpaper);
  if (Array.isArray(out.sites)) {
    out.sites = out.sites.map((s) => {
      if (!s || typeof s !== 'object') return s;
      s = { ...s };
      if (typeof s.api === 'string' && (s.api.startsWith('./') || s.api.startsWith('../'))) s.api = resolveUrl(base, s.api);
      if (typeof s.jar === 'string') s.jar = resolveUrl(base, s.jar);
      return s;
    });
  }
  if (Array.isArray(out.lives)) {
    out.lives = out.lives.map((l) => {
      if (!l || typeof l !== 'object') return l;
      l = { ...l };
      if (typeof l.url === 'string') l.url = resolveUrl(base, l.url);
      return l;
    });
  }
  return out;
}

function maybePostProcess(buf) {
  // gzip after decrypt, nested base64 after decrypt
  let finalBuf = buf;
  const g = tryGunzip(finalBuf);
  if (g) finalBuf = g;
  const i = tryInflate(finalBuf);
  if (i && scoreText(bufferToText(i)) > scoreText(bufferToText(finalBuf))) finalBuf = i;

  let text = bufferToText(finalBuf);
  // nested text encodings
  const compact = text.trim().replace(/\s+/g, '');
  if (looksLikeBase64(compact)) {
    try {
      const b = Buffer.from(compact, 'base64');
      const tb = bufferToText(b);
      if (scoreText(tb) > scoreText(text)) {
        finalBuf = b;
        text = tb;
      }
    } catch (_) {}
  }
  if (looksLikeHex(compact)) {
    try {
      const b = Buffer.from(compact, 'hex');
      const tb = bufferToText(b);
      if (scoreText(tb) > scoreText(text)) {
        finalBuf = b;
        text = tb;
      }
    } catch (_) {}
  }
  return { buf: finalBuf, text };
}


function isM3u(text) {
  if (!text) return false;
  const t = text.trim();
  return t.startsWith('#EXTM3U') || t.startsWith('#EXTINF') || /^#EXT/m.test(t.slice(0, 500));
}
function isLikelyLiveTxt(text) {
  if (!text) return false;
  const t = text.trim();
  if (isM3u(t)) return true;
  const lines = t.split(/\r?\n/).filter(Boolean).slice(0, 40);
  if (lines.length < 2) return false;
  let hits = 0;
  for (const line of lines) {
    if (/#genre#/i.test(line)) hits += 2;
    if (/^[^,#]+,https?:\/\//i.test(line)) hits += 1;
  }
  return hits >= 3;
}
function extractEmbeddedCandidates(html, baseUrl) {
  const out = [];
  const text = String(html || '');
  const blocks = [];
  const reJson = /\{[\s\S]{20,}\}/g;
  let m;
  while ((m = reJson.exec(text)) && blocks.length < 8) {
    if (/"sites"\s*:|"lives"\s*:|"spider"\s*:/.test(m[0])) blocks.push(m[0]);
  }
  for (const b of blocks) out.push({ kind: 'embedded-json', body: Buffer.from(b, 'utf8'), url: baseUrl });
  const urls = new Set();
  const reUrl = /(?:href|src|data-url|data-href|data-api|url)\s*=\s*["']([^"']+)["']/gi;
  while ((m = reUrl.exec(text))) {
    try { urls.add(new URL(m[1], baseUrl).toString()); } catch (_) {}
  }
  const reBare = /https?:\/\/[^\s"'<>]+/gi;
  while ((m = reBare.exec(text))) urls.add(m[0].replace(/[),.;]+$/, ''));
  const reLoc = /location(?:\.href)?\s*=\s*["']([^"']+)["']/gi;
  while ((m = reLoc.exec(text))) {
    try { urls.add(new URL(m[1], baseUrl).toString()); } catch (_) {}
  }
  const ranked = [...urls].sort((a, b) => {
    const score = (u) => (/\.(json|txt|m3u8?|conf)(\?|$)/i.test(u) || /tvbox|config|api|live|channel/i.test(u)) ? 0 : 1;
    return score(a) - score(b);
  }).slice(0, 12);
  for (const u of ranked) out.push({ kind: 'linked-url', url: u });
  return out;
}

function decodeConfig(input, opts) {
  opts = opts || {};
  const { baseUrl = '', customKeysPath = '', extraKeys = [] } = opts;
  const report = {
    ok: false, mode: 'unknown', algorithm: null, keyName: null, encoding: null,
    score: -1, text: '', json: null, normalized: null, attempts: [], formatsTried: []
  };

  const textIn = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (isHtml(textIn) && !opts.allowHtmlDecode) {
    if (typeof extractEmbeddedCandidates === 'function') {
      const emb = extractEmbeddedCandidates(textIn, baseUrl || 'http://local/');
      for (const e of emb) {
        if (e.body) {
          const inner = decodeConfig(e.body, Object.assign({}, opts, { allowHtmlDecode: true, baseUrl: e.url || baseUrl }));
          if (inner.ok && (inner.score || 0) > (report.score || 0)) Object.assign(report, inner, { mode: 'html-embedded' });
        }
      }
      if (report.ok) return report;
      report.linked = emb.filter((x) => x.kind === 'linked-url').map((x) => x.url);
    }
    report.mode = 'html';
    report.contentKind = 'html';
    report.text = '内容是网页(HTML)。若是跳转页，请直接用 URL 模式以便自动跟随页面内链接。';
    return report;
  }

  const direct = tryParseJson(stripBom(textIn));
  if (direct) {
    report.ok = true;
    report.mode = 'plain-json';
    report.score = 200;
    report.encoding = 'utf8';
    report.text = JSON.stringify(direct, null, 2);
    report.json = direct;
    report.normalized = baseUrl ? normalizeObj(direct, baseUrl) : direct;
    report.contentKind = 'tvbox-json';
    return report;
  }

  if (typeof isM3u === 'function' && (isM3u(textIn) || isLikelyLiveTxt(textIn))) {
    report.ok = true;
    report.mode = isM3u(textIn) ? 'm3u-live' : 'txt-live';
    report.score = isM3u(textIn) ? 160 : 140;
    report.encoding = 'utf8';
    report.contentKind = 'live-source';
    report.text = textIn.trim();
    report.json = { lives: [{ name: 'live', type: 0, url: baseUrl || '', epg: '', logo: '' }], _rawLive: true };
    report.normalized = report.json;
    return report;
  }

  const cands = candidateBuffers(input);
  const presets = [
    ...defaultKeys(),
    ...loadCustom(customKeysPath),
    ...((extraKeys || []).map(normalizePreset))
  ];

  let best = null;
  for (const c of cands) {
    report.formatsTried.push(c.l);
    const plain = bufferToText(c.b);
    if (isHtml(plain)) continue;
    let sc = scoreText(plain);
    const pj = tryParseJson(plain);
    if (pj) sc = Math.max(sc, 180);
    report.attempts.push({ step: 'candidate', encoding: c.l, score: sc });
    if (!best || sc > best.score) {
      best = {
        mode: pj ? 'plain-json' : 'encoding-only',
        algorithm: null,
        keyName: null,
        encoding: c.l,
        score: sc,
        text: plain,
        json: pj
      };
    }

    for (const p of presets) {
      const outs = decryptWithPreset(c.b, p);
      for (const item of outs) {
        const pp = maybePostProcess(item.buf);
        if (isHtml(pp.text)) continue;
        const s2 = scoreText(pp.text);
        report.attempts.push({
          step: 'decrypt',
          encoding: c.l,
          keyName: p.n,
          alg: item.alg,
          score: s2
        });
        if (!best || s2 > best.score) {
          best = {
            mode: item.alg === 'xor' ? 'xor' : 'decrypt',
            algorithm: item.alg,
            keyName: p.n || 'custom',
            encoding: c.l,
            score: s2,
            text: pp.text,
            json: tryParseJson(pp.text)
          };
        }
      }
    }
  }

  if (best && best.score >= 50) {
    report.ok = true;
    report.mode = best.mode;
    report.algorithm = best.algorithm;
    report.keyName = best.keyName;
    report.encoding = best.encoding;
    report.score = best.score;
    report.text = best.json ? JSON.stringify(best.json, null, 2) : (extractJsonBlock(best.text) || best.text);
    report.json = best.json;
    if (best.json) report.normalized = baseUrl ? normalizeObj(best.json, baseUrl) : best.json;
  } else if (best) {
    report.mode = best.mode;
    report.algorithm = best.algorithm;
    report.keyName = best.keyName;
    report.encoding = best.encoding;
    report.score = best.score;
    report.text = best.text || '未识别 / 未命中已有密钥';
    report.json = best.json;
  }

  report.attempts = report.attempts
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 25);
  report.formatsTried = [...new Set(report.formatsTried)].slice(0, 40);
  return report;
}


function expandIdnUrl(url) {
  try { return new URL(url).toString(); } catch (_) {
    try {
      const m = String(url).match(/^(https?:\/\/)([^\/?#]+)(.*)$/i);
      if (!m) return url;
      const u = new URL(m[1] + m[2]);
      return u.protocol + '//' + u.host + (m[3] || '');
    } catch (_) { return url; }
  }
}

async function fetchOnce(url, timeout, depth, opts) {
  opts = opts || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || 20000);
  try {
    const finalUrl = expandIdnUrl(url);
    const res = await fetch(finalUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': opts.userAgent || 'okhttp/3.12.11',
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'identity'
      },
      redirect: 'follow'
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      url: res.url || finalUrl,
      body: buf,
      depth: depth || 0
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUrl(url, timeout, opts) {
  return fetchOnce(url, timeout || 20000, 0, opts || {});
}

async function remoteJiemiFallback(url, timeout) {
  const ep = 'https://feiyangdigital.v1.mk/api/jiemi.php?url=' + encodeURIComponent(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeout || 25000, 40000));
  try {
    const res = await fetch(ep, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 TVBox-Jiemi/2.4',
        Referer: 'https://tools.v1.mk/',
        Accept: '*/*'
      }
    });
    const text = await res.text();
    if (!text || text.length < 2) return null;
    let candidate = text;
    const i = text.indexOf('{');
    const j = text.lastIndexOf('}');
    if (i >= 0 && j > i) candidate = text.slice(i, j + 1);
    const parsed = tryParseJson(candidate) || tryParseJson(text);
    if (parsed && (parsed.sites || parsed.spider || parsed.lives || parsed.wallpaper)) {
      const pretty = JSON.stringify(parsed, null, 2);
      return {
        ok: true,
        mode: 'remote-fallback',
        algorithm: 'remote-service',
        keyName: 'feiyangdigital',
        encoding: 'remote',
        score: 300,
        contentKind: 'tvbox-json',
        text: pretty,
        json: parsed,
        normalized: parsed,
        attempts: [{ step: 'remote-fallback', score: 300 }],
        formatsTried: ['remote-jiemi']
      };
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeLintech(bufOrText) {
  const t = Buffer.isBuffer(bufOrText) ? bufOrText.toString('utf8') : String(bufOrText || '');
  const compact = t.trim().replace(/\s+/g, '');
  if (new RegExp('^' + '24236c696e746563682324' + '', 'i').test(compact)) return true;
  if (t.indexOf('$#lintech#$') >= 0) return true;
  try {
    if (/^[0-9a-fA-F]+$/.test(compact) && compact.length >= 22) {
      const b = Buffer.from(compact.slice(0, 22), 'hex').toString('utf8');
      if (b.indexOf('lintech') >= 0) return true;
    }
  } catch (_) {}
  return false;
}


async function decryptFromUrl(url, opts) {
  opts = opts || {};
  const timeout = opts.timeoutMs || 25000;
  const chain = [];
  const allowRemote = opts.allowRemote !== false;

  let remote;
  try {
    remote = await fetchUrl(url, timeout, { userAgent: opts.userAgent || 'okhttp/3.12.11' });
  } catch (e) {
    if (allowRemote) {
      const fb = await remoteJiemiFallback(url, timeout);
      if (fb && fb.ok) {
        return Object.assign({
          source: {
            requestUrl: url,
            finalUrl: url,
            status: 0,
            contentType: 'remote/jiemi',
            bytes: (fb.text || '').length,
            chain: [{ url: url, via: 'remote-after-fetch-error', error: e.message }]
          }
        }, fb);
      }
    }
    throw new Error('抓取失败: ' + (e.message || String(e)));
  }
  chain.push({
    url: url,
    finalUrl: remote.url,
    status: remote.status,
    bytes: remote.body.length,
    contentType: remote.contentType
  });

  let decoded = decodeConfig(remote.body, Object.assign({}, opts, { baseUrl: remote.url || url }));

  // HTML page follow (link pages etc.)
  if ((!decoded.ok || decoded.mode === 'html' || decoded.contentKind === 'html') && isHtml(bufferToText(remote.body))) {
    const text = bufferToText(remote.body);
    if (typeof extractEmbeddedCandidates === 'function') {
      const emb = extractEmbeddedCandidates(text, remote.url || url);
      for (const e of emb) {
        if (e.body) {
          const inner = decodeConfig(e.body, Object.assign({}, opts, { baseUrl: e.url || remote.url || url, allowHtmlDecode: true }));
          if (inner.ok && (inner.score || 0) >= (decoded.score || 0)) {
            decoded = Object.assign({}, inner, { mode: 'html-embedded' });
          }
        }
      }
      if (!decoded.ok) {
        const links = emb.filter((x) => x.kind === 'linked-url').map((x) => x.url).slice(0, 8);
        for (const link of links) {
          try {
            const r2 = await fetchUrl(link, Math.min(timeout, 15000), { userAgent: opts.userAgent || 'okhttp/3.12.11' });
            chain.push({ url: link, finalUrl: r2.url, status: r2.status, bytes: r2.body.length, contentType: r2.contentType });
            const d2 = decodeConfig(r2.body, Object.assign({}, opts, { baseUrl: r2.url || link }));
            if (d2.ok && (d2.score || 0) >= (decoded.score || 0)) {
              decoded = Object.assign({}, d2, { mode: (d2.mode || 'decrypt') + '+followed' });
              remote = r2;
              break;
            }
          } catch (_) {}
        }
      }
      if (!decoded.ok) {
        decoded.mode = 'html-response';
        decoded.error = 'URL 返回网页(HTML)。已尝试提取页面内配置/链接，仍未得到可用内容。';
        const linked = emb.filter((x) => x.kind === 'linked-url').map((x) => x.url);
        decoded.linked = linked;
        decoded.text = decoded.error + (linked.length ? ('\n候选链接:\n' + linked.slice(0, 10).join('\n')) : '');
      }
    }
  }

  // Proprietary cipher or local fail => remote service fallback (tools.v1.mk style)
  if ((!decoded.ok || looksLikeLintech(remote.body) || looksLikeLintech(decoded.text || '')) && allowRemote) {
    const fb = await remoteJiemiFallback(url, timeout);
    if (fb && fb.ok) {
      return Object.assign({
        source: {
          requestUrl: url,
          finalUrl: remote.url,
          status: remote.status,
          contentType: remote.contentType,
          bytes: remote.body.length,
          chain: chain.concat([{ via: 'remote-fallback', note: looksLikeLintech(remote.body) ? 'lintech-cipher' : 'local-failed' }])
        }
      }, fb);
    }
  }

  if (!remote.ok && !decoded.ok) {
    throw new Error('HTTP ' + remote.status + ' - URL 返回错误');
  }

  if (!decoded.ok && looksLikeLintech(remote.body)) {
    decoded.mode = 'lintech-encrypted';
    decoded.error = '检测到 lintech 私有加密配置，本地无专用密钥；远程解密服务也未成功。';
    decoded.text = decoded.error;
  }

  return Object.assign({
    source: {
      requestUrl: url,
      finalUrl: remote.url,
      status: remote.status,
      contentType: remote.contentType,
      bytes: remote.body.length,
      chain: chain
    }
  }, decoded);
}

module.exports = {
  decodeConfig,
  decryptFromUrl,
  defaultKeyPresets: defaultKeys,
  extractJsonBlock,
  tryParseJson,
  isM3u,
  isLikelyLiveTxt,
  looksLikeLintech
};
