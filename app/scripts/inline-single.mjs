import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dir = fileURLToPath(new URL('../dist-single', import.meta.url));
let html = readFileSync(join(dir, 'index.html'), 'utf8');

const scriptMatch = html.match(
  /<script[^>]*src="([^"]+)"[^>]*><\/script>/i,
);
const styleMatch = html.match(
  /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i,
);

if (!scriptMatch || !styleMatch) {
  throw new Error('单文件构建缺少 script 或 stylesheet');
}

const js = readFileSync(resolve(dir, scriptMatch[1].replace(/^\.\//, '')), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(dir, styleMatch[1].replace(/^\.\//, '')), 'utf8')
  .replace(/<\/style/gi, '<\\/style');

html = html
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '')
  .replace(/<link[^>]*rel="manifest"[^>]*>/gi, '')
  .replace(/<link[^>]*rel="icon"[^>]*>/gi, '')
  .replace(/<link[^>]*rel="apple-touch-icon"[^>]*>/gi, '')
  .replace(/<meta[^>]*name="(?:mobile-web-app-capable|apple-mobile-web-app-capable|apple-mobile-web-app-title|apple-mobile-web-app-status-bar-style)"[^>]*>/gi, '')
  .replace(styleMatch[0], () => `<style>${css}</style>`)
  .replace(scriptMatch[0], () => `<script type="module">${js}</script>`);

writeFileSync(join(dir, 'sql-xray.html'), html, 'utf8');

for (const name of readdirSync(dir)) {
  if (name !== 'sql-xray.html') {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

const bytes = Buffer.byteLength(html);
const gzip = gzipSync(Buffer.from(html)).length;
console.log(
  `单文件：dist-single/sql-xray.html（${(bytes / 1024 / 1024).toFixed(2)} MB，gzip ${(gzip / 1024 / 1024).toFixed(2)} MB）`,
);
