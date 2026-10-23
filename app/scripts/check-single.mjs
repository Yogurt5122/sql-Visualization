import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../dist-single/sql-xray.html', import.meta.url));
const html = readFileSync(file, 'utf8');

const externalTags = [
  ...html.matchAll(
    /<(?:script|link|img|source|iframe|audio|video)\b[^>]*(?:src|href)=["'](?!data:|#)([^"']+)["']/gi,
  ),
].map((match) => match[1]);

if (externalTags.length > 0) {
  console.error('单文件仍引用外部资源：');
  for (const tag of externalTags) console.error(`  - ${tag}`);
  process.exit(1);
}

if (!html.includes('id="root"') || !/<script type="module">/.test(html)) {
  console.error('单文件缺少挂载点或内联模块脚本');
  process.exit(1);
}

if (!html.includes('<style>')) {
  console.error('单文件缺少内联样式');
  process.exit(1);
}

console.log(`单文件检查通过：${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB，无外部资源引用。`);
