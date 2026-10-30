import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const assets = join(dist, 'assets');
const limitKb = Number(process.env.BUNDLE_BUDGET_KB ?? '300');

if (!existsSync(assets)) {
  console.error('bundle 预算检查失败：找不到 dist/assets，请先运行 pnpm build');
  process.exit(1);
}
if (!Number.isFinite(limitKb) || limitKb <= 0) {
  console.error('bundle 预算检查失败：BUNDLE_BUDGET_KB 必须是正数');
  process.exit(1);
}

const entries = readdirSync(assets)
  .filter((name) => /^index-.*\.js$/.test(name))
  .sort();

if (entries.length === 0) {
  console.error('bundle 预算检查失败：没有找到 index-*.js 主入口');
  process.exit(1);
}

let totalGzip = 0;
for (const name of entries) {
  const content = readFileSync(join(assets, name));
  const gzip = gzipSync(content, { level: 9 }).length;
  totalGzip += gzip;
  console.log(`  ${name}: ${(gzip / 1024).toFixed(1)} KB gzip`);
}

const limit = limitKb * 1024;
const usedKb = totalGzip / 1024;
const remainingKb = (limit - totalGzip) / 1024;

if (totalGzip > limit) {
  console.error(
    `bundle 预算超限：${usedKb.toFixed(1)} KB gzip > ${limitKb.toFixed(1)} KB，超出 ${Math.abs(remainingKb).toFixed(1)} KB`,
  );
  process.exit(1);
}

console.log(
  `主包预算通过：${usedKb.toFixed(1)} KB gzip / ${limitKb.toFixed(1)} KB（余量 ${remainingKb.toFixed(1)} KB）`,
);
