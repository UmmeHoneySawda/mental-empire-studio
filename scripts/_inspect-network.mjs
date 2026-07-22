import fs from 'node:fs';

const p = `${process.env.TEMP}\\pw-trace-inspect\\trace.network`;
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
console.log('lines', lines.length);

let found = 0;
for (const line of lines) {
  if (!line.includes('"POST"')) continue;
  if (!/\/project|login|merge|motions|text_to_speech/.test(line)) continue;
  const o = JSON.parse(line);
  const s = o.snapshot || o;
  console.log('---');
  console.log('top keys', Object.keys(o));
  console.log('snap keys', Object.keys(s));
  if (s.request) {
    console.log('req keys', Object.keys(s.request));
    console.log('method', s.request.method, 'url', s.request.url);
    console.log('postData', JSON.stringify(s.request.postData)?.slice(0, 400));
    for (const k of Object.keys(s.request)) {
      if (/post|body|data|text/i.test(k)) {
        const v = s.request[k];
        console.log('field', k, typeof v, String(JSON.stringify(v)).slice(0, 300));
      }
    }
  }
  if (s.response) {
    console.log('res keys', Object.keys(s.response));
    console.log('status', s.response.status);
    const c = s.response.content;
    if (c) {
      console.log('content keys', Object.keys(c));
      console.log('content sample', JSON.stringify(c).slice(0, 500));
    }
  }
  found += 1;
  if (found >= 4) break;
}

console.log('\n=== content sha samples ===');
found = 0;
for (const line of lines) {
  const o = JSON.parse(line);
  const s = o.snapshot || o;
  const c = s.response?.content;
  if (!c) continue;
  if (c.text || c._sha1 || c.compression) {
    console.log(
      s.request?.method,
      (s.request?.url || '').slice(0, 100),
      Object.keys(c),
      'sha=',
      c._sha1,
      'size=',
      c.size,
      'mime=',
      c.mimeType,
    );
    found += 1;
    if (found >= 15) break;
  }
}

// list resource files that are json
const resDir = `${process.env.TEMP}\\pw-trace-inspect\\resources`;
const jsons = fs.readdirSync(resDir).filter((f) => f.endsWith('.json') || f.endsWith('.dat'));
console.log('\njson/dat count', jsons.length);
console.log(jsons.slice(0, 20));
if (jsons[0]) {
  const sample = fs.readFileSync(`${resDir}\\${jsons[0]}`, 'utf8').slice(0, 400);
  console.log('first json sample', jsons[0], sample);
}
