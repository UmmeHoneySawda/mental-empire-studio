#!/usr/bin/env node
/**
 * Mine a Playwright trace folder (trace.trace + trace.network + resources)
 * into a small, agent-friendly package under --out.
 *
 * Usage:
 *   node scripts/extract-playwright-trace.mjs --src <extracted-trace-dir> --out traces/talkingphotos-express
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const SRC = path.resolve(arg('--src', path.join(process.env.TEMP || '/tmp', 'pw-trace-inspect')));
const OUT = path.resolve(arg('--out', 'traces/talkingphotos-express'));
const SOURCE_ZIP = arg('--zip', 'D:\\playwright traces\\talkingphotos-express-session.zip');

const dirs = [
  OUT,
  path.join(OUT, '04-api-bodies'),
  path.join(OUT, '05-aria'),
  path.join(OUT, '07-screens'),
  path.join(OUT, '_raw'),
];
for (const d of dirs) fs.mkdirSync(d, { recursive: true });

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return rows;
}

function isStaticUrl(url) {
  if (!url) return true;
  return /\.(js|css|woff2?|ttf|eot|png|jpe?g|gif|svg|map|webp|mp4|webm|ico|m3u8|ts)(\?|$)/i.test(url)
    || /\/(fonts|chunk-|polyfills|styles-|media\/|assets\/img|ggpht|gstatic|ytimg|googleapis|doubleclick|googleads|youtube\.com\/s\/|youtubei\/)/i.test(url);
}

const SENSITIVE_KEY = /^(password|passwd|pwd|token|access_token|refresh_token|authorization|cookie|set-cookie|api[_-]?key|secret|secretCode|secret_code|_password|_username|_csrf_token|csrf|session|email|username|fullName|full_name|phone|address)$/i;

function sanitize(value, depth = 0) {
  if (depth > 10) return '[depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    let s = value;
    // redaction patterns
    s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer <redacted>');
    s = s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt-redacted>');
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
    s = s.replace(/(password|passwd|pwd|token|access_token|refresh_token|authorization|cookie|set-cookie|api[_-]?key|secret|_password|_username|_csrf_token)("?\s*[:=]\s*"?)([^"&\s,}]+)/gi, '$1$2<redacted>');
    // form-urlencoded style
    s = s.replace(/(_password|_username|_csrf_token|password|username|email)=([^&]+)/gi, '$1=<redacted>');
    // signed query params
    s = s.replace(/([?&](X-Amz-Signature|X-Amz-Credential|Signature|sig|token|key)=)[^&]+/gi, '$1<redacted>');
    // long base64-ish blobs
    if (s.length > 400 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return `<blob len=${s.length}>`;
    if (s.length > 8000) return s.slice(0, 8000) + `…<truncated len=${s.length}>`;
    return s;
  }
  if (Array.isArray(value)) {
    // HAR postData.params: [{name,value}]
    return value.map((v) => {
      if (v && typeof v === 'object' && 'name' in v && 'value' in v) {
        const name = String(v.name);
        if (SENSITIVE_KEY.test(name) || /password|user|csrf|token|email/i.test(name)) {
          return { name, value: '<redacted>' };
        }
        return { name, value: sanitize(v.value, depth + 1) };
      }
      return sanitize(v, depth + 1);
    });
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k) || /password|token|authorization|cookie|secret|csrf|username|email/i.test(k)) {
        out[k] = '<redacted>';
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

const RES_DIR = path.join(SRC, 'resources');

function loadShaResource(sha1Field) {
  if (!sha1Field || typeof sha1Field !== 'string') return null;
  // may be bare hash or "hash.json"
  const candidates = [
    path.join(RES_DIR, sha1Field),
    path.join(RES_DIR, sha1Field.endsWith('.json') ? sha1Field : `${sha1Field}.json`),
    path.join(RES_DIR, sha1Field.replace(/\.json$/i, '')),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      // try utf8 json/text
      const text = buf.toString('utf8');
      try {
        return JSON.parse(text);
      } catch {
        // binary or non-json
        if (text.length < 20000 && !/[\x00-\x08]/.test(text)) return text;
        return { _binary: true, _sha1: sha1Field, _bytes: buf.length };
      }
    }
  }
  return { _missingResource: sha1Field };
}

function tryParseBody(body) {
  if (body == null) return null;
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return body;
  const t = body.trim();
  if (!t) return null;
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(t); } catch { /* fallthrough */ }
  }
  return body;
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

// ---------- TRACE ----------
const tracePath = path.join(SRC, 'trace.trace');
const networkPath = path.join(SRC, 'trace.network');
const traceRows = readNdjson(tracePath);
const networkRows = readNdjson(networkPath);

const typeHist = {};
for (const r of traceRows) {
  const t = r.type || 'unknown';
  typeHist[t] = (typeHist[t] || 0) + 1;
}

// actions (before/after pairs)
const actions = [];
const byCallId = new Map();
for (const r of traceRows) {
  if (r.type === 'before') {
    const api = r.apiName || [r.class, r.method].filter(Boolean).join('.') || 'unknown';
    const entry = {
      callId: r.callId,
      api,
      class: r.class,
      method: r.method,
      params: sanitize(r.params || r),
      startWallTime: r.wallTime,
      startTime: r.startTime || r.time,
    };
    byCallId.set(r.callId, entry);
    actions.push(entry);
  } else if (r.type === 'after') {
    const entry = byCallId.get(r.callId);
    if (entry) {
      entry.endWallTime = r.wallTime;
      entry.endTime = r.endTime || r.time;
      entry.error = r.error || null;
      // result may be huge (aria snapshot string)
      if (r.result != null) {
        if (typeof r.result === 'string') {
          entry.resultPreview = r.result.slice(0, 300);
          entry.resultLen = r.result.length;
          if (entry.api.includes('ariaSnapshot') || /^- (generic|banner|main|heading|button)/m.test(r.result)) {
            entry.ariaSnapshot = r.result;
          }
        } else if (typeof r.result === 'object') {
          if (typeof r.result.snapshot === 'string') {
            entry.ariaSnapshot = r.result.snapshot;
            entry.resultPreview = r.result.snapshot.slice(0, 300);
            entry.resultLen = r.result.snapshot.length;
          } else {
            entry.result = sanitize(r.result);
          }
        }
      }
    }
  }
}

// console
const consoleMsgs = [];
for (const r of traceRows) {
  if (r.type === 'console' || r.messageType) {
    consoleMsgs.push(sanitize({
      type: r.messageType || r.type,
      text: r.text || r.params?.text || '',
      location: r.location || r.params?.location || null,
      args: r.args || r.params?.args || null,
    }));
  }
  // some traces embed console as before Page.consoleMessages results only
}

// also harvest console from after Page.consoleMessages if present
for (const a of actions) {
  if (a.api === 'Page.consoleMessages' && Array.isArray(a.result)) {
    for (const m of a.result) consoleMsgs.push(sanitize(m));
  }
}

// frame snapshots (DOM)
const frameSnaps = [];
for (const r of traceRows) {
  if (r.type === 'frame-snapshot' && r.snapshot) {
    const s = r.snapshot;
    frameSnaps.push({
      callId: s.callId,
      snapshotName: s.snapshotName,
      frameUrl: s.frameUrl,
      isMainFrame: s.isMainFrame,
      viewport: s.viewport,
      wallTime: s.wallTime,
      timestamp: s.timestamp,
      hasHtml: !!s.html,
      htmlKind: Array.isArray(s.html) ? (typeof s.html[0] === 'string' ? 'tree' : 'ref') : typeof s.html,
    });
  }
}

// unique main-frame URLs over time
const pageUrls = [...new Set(frameSnaps.filter((s) => s.isMainFrame).map((s) => s.frameUrl).filter(Boolean))];

// ARIA dumps
const ariaSnaps = actions
  .filter((a) => a.ariaSnapshot)
  .map((a, i) => ({
    index: i + 1,
    callId: a.callId,
    api: a.api,
    wallTime: a.startWallTime,
    snapshot: a.ariaSnapshot,
  }));

// dedupe aria by content hash, keep first of each unique screen-ish
const ariaByHash = new Map();
for (const a of ariaSnaps) {
  const h = sha1(a.snapshot);
  if (!ariaByHash.has(h)) ariaByHash.set(h, a);
}
const uniqueAria = [...ariaByHash.values()];

// guess screen name from aria text
function screenName(snap) {
  const t = snap.snapshot;
  if (/Sign in to yo/i.test(t) || /heading "Sign in/i.test(t)) return 'sign-in';
  if (/My Videos|my-videos/i.test(t) && /part \d+ of \d+/i.test(t)) return 'my-videos';
  if (/My Videos|my videos/i.test(t)) return 'my-videos';
  if (/Homepage|Welcome|What's new|Create Video/i.test(t)) return 'homepage';
  if (/Create|motion|text to speech|TTS/i.test(t)) return 'create-or-form';
  return `screen-${snap.index}`;
}

// write aria files
const ariaIndex = [];
for (const a of uniqueAria) {
  const name = screenName(a);
  let file = `${String(a.index).padStart(2, '0')}-${name}.md`;
  // avoid overwrite
  let n = 1;
  while (fs.existsSync(path.join(OUT, '05-aria', file))) {
    n += 1;
    file = `${String(a.index).padStart(2, '0')}-${name}-${n}.md`;
  }
  const body = [
    `# ${name}`,
    '',
    `- callId: ${a.callId || ''}`,
    `- wallTime: ${a.wallTime || ''}`,
    `- api: ${a.api}`,
    `- chars: ${a.snapshot.length}`,
    '',
    '```',
    a.snapshot,
    '```',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, '05-aria', file), body);
  ariaIndex.push({ file, name, callId: a.callId, chars: a.snapshot.length });
}

// ---------- NETWORK ----------
// Playwright network file: resource-snapshot HAR-like entries
const requests = [];
for (const r of networkRows) {
  const snap = r.snapshot || r;
  const req = snap.request || r.request;
  const res = snap.response || r.response;
  if (!req?.url) continue;
  const url = req.url;
  const method = req.method || 'GET';
  const status = res?.status ?? null;
  const mime = res?.content?.mimeType || res?.mimeType || null;
  const entry = {
    method,
    url,
    path: shortUrl(url),
    status,
    mime,
    startedDateTime: snap.startedDateTime || null,
    time: snap.time ?? null,
    static: isStaticUrl(url),
    requestHeaders: sanitize(
      Object.fromEntries((req.headers || []).map((h) => [h.name, h.value])),
    ),
    responseHeaders: sanitize(
      Object.fromEntries((res?.headers || []).map((h) => [h.name, h.value])),
    ),
    requestBody: null,
    responseBody: null,
  };

  // post data — Playwright often stores body in resources via postData._sha1
  if (req.postData) {
    const pd = req.postData;
    if (pd._sha1) {
      entry.requestBody = sanitize(loadShaResource(pd._sha1));
    } else if (pd.params && pd.params.length) {
      entry.requestBody = sanitize(pd.params);
    } else if (pd.text) {
      entry.requestBody = sanitize(tryParseBody(pd.text));
    } else {
      entry.requestBody = sanitize(pd);
    }
  }

  // response content via text or _sha1 resource blob
  if (res?.content) {
    const c = res.content;
    if (c._sha1) {
      entry.responseBody = sanitize(loadShaResource(c._sha1));
    } else if (c.text != null) {
      const decoded = c.encoding === 'base64'
        ? Buffer.from(c.text, 'base64').toString('utf8')
        : c.text;
      entry.responseBody = sanitize(tryParseBody(decoded));
    }
  }

  requests.push(entry);
}

const appRequests = requests.filter((r) => !r.static);
const staticCount = requests.length - appRequests.length;

// network index (no bodies)
const networkIndex = appRequests.map((r, i) => ({
  i: i + 1,
  method: r.method,
  status: r.status,
  path: r.path,
  url: r.url.replace(/([?&](X-Amz-Signature|X-Amz-Credential|Signature|sig|token)=)[^&]+/gi, '$1<redacted>'),
  mime: r.mime,
  startedDateTime: r.startedDateTime,
  timeMs: r.time,
  hasRequestBody: r.requestBody != null,
  hasResponseBody: r.responseBody != null,
}));

// group by method+path pattern
function pathPattern(p) {
  return p
    .replace(/\/\d{4,}/g, '/{id}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/page=\d+/g, 'page={n}')
    .replace(/limit=\d+/g, 'limit={n}');
}

const groups = new Map();
for (const r of appRequests) {
  const key = `${r.method} ${pathPattern(r.path)}`;
  if (!groups.has(key)) {
    groups.set(key, { key, count: 0, statuses: {}, samples: [] });
  }
  const g = groups.get(key);
  g.count += 1;
  const st = String(r.status ?? 'null');
  g.statuses[st] = (g.statuses[st] || 0) + 1;
  if (g.samples.length < 3) {
    g.samples.push({
      url: r.url.split('?')[0],
      status: r.status,
      requestBody: r.requestBody,
      responseBodyPreview: summarizeBody(r.responseBody),
    });
  }
}

function summarizeBody(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body.slice(0, 400);
  if (Array.isArray(body)) {
    return {
      type: 'array',
      length: body.length,
      item0Keys: body[0] && typeof body[0] === 'object' ? Object.keys(body[0]).slice(0, 40) : null,
      item0: body[0] && typeof body[0] === 'object' ? pickPreview(body[0]) : body[0],
    };
  }
  if (typeof body === 'object') return pickPreview(body);
  return body;
}

function pickPreview(obj) {
  const out = {};
  const keys = Object.keys(obj).slice(0, 50);
  for (const k of keys) {
    const v = obj[k];
    if (v != null && typeof v === 'object') {
      if (Array.isArray(v)) out[k] = `array(len=${v.length})`;
      else out[k] = `object(keys=${Object.keys(v).slice(0, 12).join(',')})`;
    } else if (typeof v === 'string' && v.length > 120) {
      out[k] = v.slice(0, 120) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

// write API body samples for non-static app endpoints (deduped by method+pattern)
const writtenBodies = new Map();
let bodyN = 0;
for (const r of appRequests) {
  if (r.requestBody == null && r.responseBody == null) continue;
  // only TalkingPhotos app host for body dumps (skip YouTube/ads noise)
  if (!/talkingphotos\.ai|renderplatform\.com|ws\.talkingphotos/i.test(r.url)) continue;
  // skip pure websocket upgrade noise without JSON
  const key = `${r.method} ${pathPattern(r.path)}`;
  const countForKey = writtenBodies.get(key) || 0;
  if (countForKey >= 2) continue; // max 2 samples per pattern
  writtenBodies.set(key, countForKey + 1);
  bodyN += 1;
  const safeName = `${String(bodyN).padStart(2, '0')}-${r.method}-${pathPattern(r.path)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)}.json`;
  const payload = sanitize({
    method: r.method,
    url: r.url.replace(/([?&](X-Amz-Signature|X-Amz-Credential|Signature|sig|token)=)[^&]+/gi, '$1<redacted>'),
    status: r.status,
    mime: r.mime,
    startedDateTime: r.startedDateTime,
    requestBody: r.requestBody,
    responseBody: r.responseBody,
  });
  fs.writeFileSync(path.join(OUT, '04-api-bodies', safeName), JSON.stringify(payload, null, 2));
}

// write network index
fs.writeFileSync(path.join(OUT, '03-network-index.json'), JSON.stringify({
  totalRequests: requests.length,
  appRequests: appRequests.length,
  staticRequests: staticCount,
  entries: networkIndex,
  grouped: [...groups.values()].sort((a, b) => b.count - a.count),
}, null, 2));

// 01-actions.md
const actionLines = [
  '# Actions',
  '',
  `Source: \`${SOURCE_ZIP}\``,
  `Total before/after pairs: ${actions.length}`,
  '',
  '| # | callId | api | note |',
  '|--:|--------|-----|------|',
];
actions.forEach((a, i) => {
  let note = '';
  if (a.ariaSnapshot) note = `aria ${a.ariaSnapshot.length} chars`;
  else if (a.error) note = `error: ${JSON.stringify(a.error).slice(0, 80)}`;
  else if (a.resultPreview) note = a.resultPreview.replace(/\n/g, ' ').slice(0, 80);
  actionLines.push(`| ${i + 1} | ${a.callId || ''} | ${a.api} | ${note.replace(/\|/g, '/')} |`);
});
actionLines.push('');
fs.writeFileSync(path.join(OUT, '01-actions.md'), actionLines.join('\n'));

// 02-console.md
const consoleLines = [
  '# Console',
  '',
  `Messages: ${consoleMsgs.length}`,
  '',
];
consoleMsgs.forEach((m, i) => {
  const text = typeof m === 'string' ? m : (m.text || JSON.stringify(m));
  consoleLines.push(`## ${i + 1}. ${m.type || 'log'}`);
  consoleLines.push('');
  consoleLines.push('```');
  consoleLines.push(String(text));
  consoleLines.push('```');
  consoleLines.push('');
});
fs.writeFileSync(path.join(OUT, '02-console.md'), consoleLines.join('\n'));

// 06-dom-notes.md
const domLines = [
  '# DOM notes (frame-snapshots)',
  '',
  `Frame snapshots: ${frameSnaps.length}`,
  '',
  '## Main-frame URLs observed',
  '',
  ...pageUrls.map((u) => `- ${u}`),
  '',
  '## Snapshot inventory',
  '',
  '| # | url | main | html | viewport |',
  '|--:|-----|:----:|------|----------|',
];
frameSnaps.forEach((s, i) => {
  const vp = s.viewport ? `${s.viewport.width}x${s.viewport.height}` : '';
  domLines.push(`| ${i + 1} | ${s.frameUrl || ''} | ${s.isMainFrame ? 'yes' : ''} | ${s.htmlKind} | ${vp} |`);
});
domLines.push('');
domLines.push('Notes:');
domLines.push('- Playwright stores DOM as a compact HTML tree (or ref to a prior tree), not always a full outerHTML string.');
domLines.push('- Prefer `05-aria/*.md` for UX structure; use DOM snapshots for tag/class detail when needed.');
domLines.push('- Full trees live in `_raw/trace.trace` (type=frame-snapshot).');
domLines.push('');
fs.writeFileSync(path.join(OUT, '06-dom-notes.md'), domLines.join('\n'));

// 00-index.md
const interesting = [...groups.values()]
  .filter((g) => !/youtube|doubleclick|google/i.test(g.key))
  .sort((a, b) => b.count - a.count);

const indexMd = [
  '# TalkingPhotos Express — Playwright session extract',
  '',
  'Agent-friendly package mined from a full Playwright trace. **Do not open the raw zip first.** Use this folder.',
  '',
  '## Source',
  '',
  `- Zip: \`${SOURCE_ZIP}\``,
  `- Extracted at: ${new Date().toISOString()}`,
  `- Raw copies: \`_raw/trace.trace\`, \`_raw/trace.network\`, \`_raw/trace.stacks\``,
  '',
  '## What this capture is',
  '',
  '- **Kind:** observation + light interaction session (not a full click-script redesign of every control).',
  '- **App:** https://app.talkingphotos.ai (Talking Photos Express web SaaS).',
  `- **Main URLs:** ${pageUrls.join(', ') || '(see 06-dom-notes)'}`,
  `- **Trace event types:** ${Object.entries(typeHist).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  `- **Network:** ${requests.length} total resource snapshots; **${appRequests.length} non-static**; ${staticCount} static/asset.`,
  `- **ARIA unique screens:** ${uniqueAria.length} (see \`05-aria/\`)`,
  `- **Console messages:** ${consoleMsgs.length}`,
  `- **Frame DOM snapshots:** ${frameSnaps.length}`,
  `- **Screencast frames in original zip:** ~5102 (only a few samples copied to \`07-screens/\`)`,
  '',
  '## Folder map',
  '',
  '| Path | Contents |',
  '|------|----------|',
  '| `00-index.md` | This file |',
  '| `01-actions.md` | Playwright API actions in order |',
  '| `02-console.md` | Console + WebSocket progress logs |',
  '| `03-network-index.json` | All non-static requests + grouped patterns |',
  '| `04-api-bodies/` | Sanitized request/response samples per API pattern |',
  '| `05-aria/` | Unique accessibility trees per screen |',
  '| `06-dom-notes.md` | Frame snapshot inventory |',
  '| `07-screens/` | Sample images (not full screencast) |',
  '| `08-gaps.md` | What this capture does NOT contain |',
  '| `EXPRESS-SESSION-REPORT.md` | Full mining report for redesign agents |',
  '| `AGENT-PROMPT.md` | Copy-paste prompt for the next agent |',
  '| `_raw/` | Original trace.trace / network (large) |',
  '',
  '## Top app API patterns (by count)',
  '',
  '| Count | Pattern | Statuses |',
  '|------:|---------|----------|',
  ...interesting.slice(0, 40).map((g) => {
    const st = Object.entries(g.statuses).map(([k, v]) => `${k}×${v}`).join(', ');
    return `| ${g.count} | \`${g.key}\` | ${st} |`;
  }),
  '',
  '## WebSocket / progress (from console)',
  '',
  'See `02-console.md`. Observed:',
  '',
  '- `wss://ws.talkingphotos.ai/` Notification Center',
  '- `code:102` started inference + `estimated_time` + `host_name`',
  '- `code:200` completion + `out_path` (S3) + `num_units` + `commit_id`',
  '',
  '## Security',
  '',
  'Bodies and headers were **redacted** (tokens, cookies, emails, signed query params). Treat remaining media URLs as sensitive.',
  '',
];
fs.writeFileSync(path.join(OUT, '00-index.md'), indexMd.join('\n'));

// 08-gaps.md
const gaps = [
  '# Gaps — not fully present in this capture',
  '',
  'Be explicit with the next agent: **do not invent these.**',
  '',
  '## Likely incomplete or missing UX/API in THIS session',
  '',
  '- Full **Create form** walkthrough as a dedicated aria screen (session has motions/TTS/project POSTs, but UI tree focus is login/home/my-videos).',
  '- **Cancel in-flight job** control (not observed).',
  '- Exhaustive pagination UX beyond page 1→2 style requests.',
  '- Error recovery UI for every 422/405 (console shows failures; full error UI not mapped).',
  '- Settings / billing deep pages (account/purchases requested but limited UI snapshot coverage).',
  '- Voice clone **creation** flow (list endpoints present; full clone wizard not proven).',
  '- Mobile viewport layouts (viewport ~1920×897 desktop).',
  '- Every screencast frame (5102 frames not copied; samples only).',
  '',
  '## Use other sources for API truth',
  '',
  '- Repo: `docs/TALKINGPHOTOS-HAR-CONTRACT.md` (sanitized HAR contract for POST /project variants).',
  '- Repo: `electron/providers/talkingphotos/*`, `shared/talkingphotos.ts`, `src/store/useTalkingPhotos.ts`.',
  '',
  '## Capture recommendations for next session',
  '',
  '1. One trace: Create Human (TTS) end-to-end with snapshot after every step.',
  '2. One trace: Create Human (uploaded audio) + trim.',
  '3. One trace: Merge videos.',
  '4. One HAR export with **Preserve log** for API bodies only.',
  '',
];
fs.writeFileSync(path.join(OUT, '08-gaps.md'), gaps.join('\n'));

// EXPRESS-SESSION-REPORT.md
const report = [];
report.push('# EXPRESS-SESSION-REPORT');
report.push('');
report.push('Mined automatically from Playwright trace. Sanitize applied. Use with `docs/TALKINGPHOTOS-HAR-CONTRACT.md` and the Mental Empire Talking Video code.');
report.push('');
report.push('## 1. Timeline / pages');
report.push('');
report.push('Observed main-frame URLs:');
for (const u of pageUrls) report.push(`- ${u}`);
report.push('');
report.push('Dominant Playwright probes: `Frame.ariaSnapshot`, `Page.consoleMessages`, `Frame.title`, `Frame.evaluateExpression`, plus network resource snapshots and screencast.');
report.push('');
report.push('## 2. Screen inventory (ARIA)');
report.push('');
for (const a of ariaIndex) {
  report.push(`- \`${a.file}\` → **${a.name}** (${a.chars} chars)`);
}
report.push('');
report.push('Open each file under `05-aria/` for full trees.');
report.push('');
report.push('## 3. UI signals (from ARIA + product knowledge of this session)');
report.push('');
report.push('- **Sign in:** branded login form.');
report.push('- **Homepage:** welcome / news / cross-sell style landing after auth.');
report.push('- **My Videos:** project cards, type badges (e.g. Human / Merge), titles with `· part X of Y`, relative timestamps, quick actions, search/filter/pagination patterns consistent with `/project?page=&limit=` traffic.');
report.push('');
report.push('## 4. API inventory');
report.push('');
report.push('| Count | Method + path pattern | Statuses |');
report.push('|------:|----------------------|----------|');
for (const g of interesting) {
  const st = Object.entries(g.statuses).map(([k, v]) => `${k}×${v}`).join(', ');
  report.push(`| ${g.count} | \`${g.key}\` | ${st} |`);
}
report.push('');
report.push('Full list + samples: `03-network-index.json`, bodies in `04-api-bodies/`.');
report.push('');
report.push('### Notable product APIs in this session');
report.push('');
const notable = [
  ['Auth', 'POST /login, GET /account'],
  ['Projects', 'GET /project?page&limit, GET status=completed, POST /project, GET /project/download/{id}'],
  ['Merge', 'POST /project/merge_videos'],
  ['Quotas', 'GET /project/concurrent_limit/human, GET /project/video_daily_usage, POST /project/video_duration_limit'],
  ['Motions', 'GET /motions/list/human?motion_type&gender&aspect_ratio&style'],
  ['TTS', 'GET /text_to_speech/languages, GET /text_to_speech/voices/{locale}'],
  ['Voice clone', 'GET /voice_clone/languages, GET /voice_clone/voices/cloned'],
  ['Library', 'GET /library/categories, POST /library/categories/upload/{id}'],
  ['Image gen', 'POST /ai_api/create_image_from_prompt'],
  ['News / commerce', 'GET /news, GET /purchases'],
  ['Realtime', 'GET wss://ws.talkingphotos.ai/'],
];
for (const [k, v] of notable) report.push(`- **${k}:** ${v}`);
report.push('');
report.push('## 5. WebSocket progress contract (console)');
report.push('');
report.push('```json');
report.push(JSON.stringify({
  start: {
    uid: '<uuid>',
    status: true,
    code: 102,
    estimated_time: 60,
    log_message: 'started inference',
    host_name: 'gpu5090-140',
  },
  done: {
    uid: '<uuid>',
    status: true,
    code: 200,
    num_units: 0.984375,
    seed: 1262,
    out_path: 'https://s3.renderplatform.com/user-assets/preview/<uuid>.png',
    commit_id: 'v4.9.55',
  },
}, null, 2));
report.push('```');
report.push('');
report.push('Also: connect/disconnect logs; some HTTP 422/405 failures in console.');
report.push('');
report.push('## 6. Progress / liveliness UX implications');
report.push('');
report.push('- Show **ETA** from `estimated_time`.');
report.push('- Show **host** optionally (`host_name`).');
report.push('- Show **status text** from `log_message`.');
report.push('- On `code:200`, attach preview via `out_path` / local download pipeline.');
report.push('- Gallery should tolerate **multi-part** titles and pagination (`limit=12` style).');
report.push('');
report.push('## 7. Mapping guidance (Express → our app)');
report.push('');
report.push('| Express signal | Likely our surface |');
report.push('|----------------|--------------------|');
report.push('| My Videos cards | `TalkingVideo` jobs list / remote projects |');
report.push('| part X of Y | segment fields already in provider/job model |');
report.push('| WS ETA/host | provider job progress events (`onProviderJob`) |');
report.push('| GET /project | `talkingPhotos.projects()` IPC |');
report.push('| POST /project | create job IPC |');
report.push('| motions list | `ProviderMotion` / create form |');
report.push('| TTS voices | createScript / TTS IPC |');
report.push('| merge_videos | internal localMerge / remote merge capability |');
report.push('| download | localOutputPath / remoteMediaUrl open |');
report.push('');
report.push('Fill exact field-level mapping in the redesign pass by reading `shared/types.ts` + `useTalkingPhotos.ts` — do not invent IPC.');
report.push('');
report.push('## 8. Not in this capture');
report.push('');
report.push('See `08-gaps.md`.');
report.push('');

fs.writeFileSync(path.join(OUT, 'EXPRESS-SESSION-REPORT.md'), report.join('\n'));

// AGENT-PROMPT.md
const prompt = `# AGENT-PROMPT — attach this folder + paste below

Copy everything under the line into the next agent chat. Attach/upload the folder:

\`${OUT.replace(/\\/g, '/')}\`

(or zip that folder if the agent UI needs a single file).

Also attach or ensure repo access to:
- \`docs/TALKINGPHOTOS-HAR-CONTRACT.md\`
- \`src/screens/TalkingVideo.tsx\`
- \`src/store/useTalkingPhotos.ts\`
- \`electron/providers/talkingphotos/*\`
- \`shared/talkingphotos.ts\` / \`shared/types.ts\`

---

## Prompt

You are mining + planning against **TalkingPhotos Express** (web SaaS) as the UX north star for our desktop app **Talking Video** screen.

### Inputs (use ALL of them)

1. Pre-extracted session package: \`traces/talkingphotos-express/\`  
   Start at \`00-index.md\` and \`EXPRESS-SESSION-REPORT.md\`.  
   **Do not** start by unzipping the raw Playwright zip or decoding 5000 screencast frames.
2. API contract HARs: \`docs/TALKINGPHOTOS-HAR-CONTRACT.md\`
3. Our app code (renderer + store + provider). Backend works — **do not change or break** \`electron/providers/talkingphotos/*\`, IPC contracts, or DB unless a later approved phase requires it.

### Hard rules

- Prefer pre-extracted files over the raw zip.
- Do not invent UI that is not in \`05-aria/\`, screenshots, or the report.
- Do not invent API fields not in \`03-network-index.json\`, \`04-api-bodies/\`, or the HAR contract.
- If something is missing, write **UNKNOWN** and how to capture it (see \`08-gaps.md\`).
- Keep our visual identity: near-black \`#070809\` + amber \`#f5b323\`, Space Grotesk — design *within* it, do not clone Express branding.
- Tests: vitest \`environment: 'node'\` — **no React DOM tests**. Pure logic + store tests only.
- Deliver **plan first** unless the user explicitly says implement.

### Required checklist (every item must appear in your report)

- [ ] Timeline of pages/actions
- [ ] Screen inventory (login / home / my-videos / others)
- [ ] UI components per screen (from aria + screens)
- [ ] Full API inventory (method, path pattern, status, purpose)
- [ ] For important POST/GET: request + response schema summary
- [ ] WebSocket messages (ETA, host, codes, out_path)
- [ ] Progress UX signals
- [ ] Mapping table: Express UI → API → our IPC/store field (or MISSING / DEAD UI)
- [ ] Explicit “not in this capture” list
- [ ] Phased redesign plan (P0 liveliness → P1 parity → P2 depth) renderer/store only where possible
- [ ] Test plan aligned with node/vitest constraints

### Output files to write

1. \`docs/trace-mining/EXPRESS-SESSION-AGENT-REPORT.md\` (checklist complete)
2. \`docs/TALKING_VIDEO_REDESIGN.md\` (phased plan only — no code until asked)

### Baseline

If you implement later: keep \`typecheck\`, \`build\`, and \`npx vitest run test/unit/talkingphotos-*.test.ts\` green each phase. Gate UI behind existing TalkingPhotos enabled settings.

Begin by reading \`traces/talkingphotos-express/00-index.md\` and \`EXPRESS-SESSION-REPORT.md\`, then the ARIA files, then network index, then our TalkingVideo store/screen.
`;

fs.writeFileSync(path.join(OUT, 'AGENT-PROMPT.md'), prompt);

// also a plain prompt-only file for easy copy
fs.writeFileSync(path.join(OUT, 'COPY-PASTE-PROMPT.txt'), prompt.split('---\n\n## Prompt\n\n')[1] || prompt);

// summary stats json
fs.writeFileSync(path.join(OUT, '_raw', 'extract-stats.json'), JSON.stringify({
  sourceZip: SOURCE_ZIP,
  src: SRC,
  out: OUT,
  traceEvents: traceRows.length,
  typeHist,
  actions: actions.length,
  console: consoleMsgs.length,
  frameSnaps: frameSnaps.length,
  pageUrls,
  requests: requests.length,
  appRequests: appRequests.length,
  ariaUnique: uniqueAria.length,
  apiBodyFiles: bodyN,
  groups: groups.size,
}, null, 2));

console.log(JSON.stringify({
  ok: true,
  out: OUT,
  pageUrls,
  actions: actions.length,
  console: consoleMsgs.length,
  appRequests: appRequests.length,
  ariaFiles: ariaIndex.length,
  apiBodies: bodyN,
  groups: interesting.length,
}, null, 2));
