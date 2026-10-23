import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = [
  fileURLToPath(new URL('../dist', import.meta.url)),
  fileURLToPath(new URL('../dist-single', import.meta.url)),
].filter((root) => existsSync(root));

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else files.push(path);
  }
}
for (const root of roots) walk(root);

const problems = [];

const networkApis = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
];

const externalRef =
  /(?:src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//gi;

for (const file of files) {
  const ext = extname(file);
  const text = readFileSync(file, 'utf8');

  if (ext === '.js') {
    for (const api of networkApis) {
      if (api.pattern.test(text)) {
        problems.push(`${file}: 发现网络 API ${api.name}`);
      }
    }
  }

  if (ext === '.html' || ext === '.css') {
    if (externalRef.test(text)) {
      problems.push(`${file}: 引用了外部 URL`);
    }
    externalRef.lastIndex = 0;
  }
}

if (problems.length > 0) {
  console.error('隐私检查未通过：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `隐私检查通过：扫描 ${files.length} 个构建产物文件，未发现网络 API 或外部资源引用。`,
);
