import fs from 'node:fs';
import path from 'node:path';

const dir = 'traces/talkingphotos-express/04-api-bodies';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

function keysOf(o, d = 0) {
  if (!o || typeof o !== 'object' || d > 2) return null;
  if (Array.isArray(o)) {
    if (o[0] && typeof o[0] === 'object') return ['[]', ...Object.keys(o[0]).slice(0, 40)];
    return [`array(len=${o.length})`];
  }
  return Object.keys(o).slice(0, 50);
}

const md = [
  '# API body schema cheatsheet',
  '',
  'Auto-derived from sanitized samples in `04-api-bodies/`.',
  '',
];

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  md.push(`## ${f}`);
  md.push('');
  md.push(`- \`${j.method} ${j.url}\``);
  md.push(`- status: \`${j.status}\``);
  if (j.requestBody != null) md.push(`- request shape: \`${JSON.stringify(keysOf(j.requestBody))}\``);
  if (j.responseBody != null) md.push(`- response shape: \`${JSON.stringify(keysOf(j.responseBody))}\``);
  md.push('');
}

fs.writeFileSync('traces/talkingphotos-express/04-api-schemas.md', md.join('\n'));
console.log('wrote schemas for', files.length, 'bodies');
