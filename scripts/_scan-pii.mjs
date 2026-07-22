import fs from 'node:fs';
import path from 'node:path';

function walk(d, hits) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, hits);
    else {
      const t = fs.readFileSync(p, 'utf8');
      if (/UYofcHbroM9F|nazmulislampi@/i.test(t)) hits.push(['LEAK_CREDS', p]);
      if (/"password"\s*:\s*"(?!<)/i.test(t)) hits.push(['PWD_FIELD', p]);
      if (/"_password"\s*:\s*"(?!<)/i.test(t)) hits.push(['PWD_FIELD', p]);
    }
  }
}

const hits = [];
walk('traces/talkingphotos-express', hits);
if (!hits.length) console.log('OK: no credential leaks found');
else for (const h of hits) console.log(h[0], h[1]);
