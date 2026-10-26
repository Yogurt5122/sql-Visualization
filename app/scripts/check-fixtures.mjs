import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'node-sql-parser';

const { Parser } = pkg;
const parser = new Parser();

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const CORPUS_ROOT = join(APP_ROOT, 'tests', 'corpus');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-single', '.git', 'coverage']);

const TEXT_EXTENSIONS = new Set([
  '.sql',
  '.xml',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
]);

const LEGACY_PREFIX =
  /\b(?:dwd|dim|dm|ods|dws|ads|fact|sys|app|web)_[A-Za-z][A-Za-z0-9_$]*/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function dialectFor(file) {
  if (file.startsWith('postgres_')) return 'postgresql';
  if (file.startsWith('tsql_')) return 'transactsql';
  return 'mysql';
}

function cteNames(sql) {
  const names = new Set();
  const pattern =
    /(?:\bWITH\b|,)\s*([`"[]?[A-Za-z_][\w$#]*[`"\]]?)\s*(?:\([^)]*\)\s*)?AS\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    names.add(match[1].replace(/[`"[\]]/g, '').toLowerCase());
  }
  return names;
}

function regexTableNames(sql) {
  const names = [];
  const pattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+([`"[]?[A-Za-z_][\w$#.]*[`"\]]?)/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    names.push(match[1].replace(/[`"[\]]/g, ''));
  }
  return names;
}

function parsedTableNames(sql, dialect) {
  try {
    return parser
      .tableList(sql, { database: dialect })
      .map((entry) => entry.split('::').pop())
      .filter(Boolean);
  } catch {
    return regexTableNames(sql);
  }
}

function shortName(name) {
  return name.split('.').pop().toLowerCase();
}

const problems = [];
const sqlFiles = readdirSync(CORPUS_ROOT)
  .filter((name) => name.endsWith('.sql') && !name.startsWith('broken_'))
  .sort();

for (const file of sqlFiles) {
  const sql = readFileSync(join(CORPUS_ROOT, file), 'utf8');
  const ctes = cteNames(sql);
  for (const table of parsedTableNames(sql, dialectFor(file))) {
    const name = shortName(table);
    if (name.startsWith('t_demo_')) continue;
    if (ctes.has(name)) continue;
    if (name === 'dual') continue;
    problems.push(`非 t_demo 表名：${file} -> ${table}`);
  }
}

// 防止旧业务命名通过 README、源码示例、XML 等绕回仓库。
for (const file of walk(REPO_ROOT)) {
  if (!TEXT_EXTENSIONS.has(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    LEGACY_PREFIX.lastIndex = 0;
    let match;
    while ((match = LEGACY_PREFIX.exec(lines[i]))) {
      problems.push(
        `旧业务前缀：${file.slice(REPO_ROOT.length + 1)}:${i + 1} -> ${match[0]}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('表名检查未通过：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `表名检查通过：${sqlFiles.length} 份 SQL 语料表名均为 t_demo_*，全仓库无旧业务前缀。`,
);
