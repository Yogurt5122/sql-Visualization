import { splitTopLevel } from './sql-text';

const CREATE_TABLE =
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w$#.]+[`"\]]?)\s*\(/gi;

const CONSTRAINT_WORDS = new Set([
  'PRIMARY',
  'UNIQUE',
  'FOREIGN',
  'CHECK',
  'CONSTRAINT',
  'INDEX',
  'KEY',
]);

const TYPE_STOP_WORDS = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'PRIMARY',
  'UNIQUE',
  'REFERENCES',
  'CHECK',
  'COMMENT',
  'COLLATE',
  'GENERATED',
  'AUTO_INCREMENT',
  'IDENTITY',
  'CONSTRAINT',
]);

function unquoteIdentifier(value: string): string {
  return value.trim().replace(/^[`"[]|[`"\]]$/g, '');
}

function findClosingParen(sql: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseColumnType(definition: string): { name: string; type: string } | null {
  const match = /^([`"[]?[A-Za-z_][\w$#]*[`"\]]?)\s+(.+)$/s.exec(definition.trim());
  if (!match) return null;

  const name = unquoteIdentifier(match[1]!);
  if (CONSTRAINT_WORDS.has(name.toUpperCase())) return null;

  const rest = match[2]!.trim();
  const typeMatch = /^([A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?)/.exec(rest);
  if (!typeMatch) return null;

  let type = typeMatch[1]!.replace(/\s+/g, ' ');
  const firstWord = type.split(/\s+/)[0]!.toUpperCase();
  if (TYPE_STOP_WORDS.has(firstWord)) return null;

  return { name, type: type.toUpperCase() };
}

/**
 * 从 CREATE TABLE 中提取一份轻量 schema，供预输出显示字段类型。
 * 只做静态文本解析，不依赖数据库连接。
 */
export function parseDdlSchema(sql: string): Map<string, Map<string, string>> {
  const schema = new Map<string, Map<string, string>>();

  CREATE_TABLE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREATE_TABLE.exec(sql))) {
    const tableName = unquoteIdentifier(match[1]!);
    const open = sql.indexOf('(', match.index);
    const close = findClosingParen(sql, open);
    if (open < 0 || close < 0) continue;

    const body = sql.slice(open + 1, close);
    const columns = new Map<string, string>();
    for (const part of splitTopLevel(body, ',')) {
      const column = parseColumnType(part);
      if (column) columns.set(column.name.toLowerCase(), column.type);
    }

    if (columns.size === 0) continue;

    const key = tableName.toLowerCase();
    schema.set(key, columns);
    const unqualified = key.split('.').pop();
    if (unqualified && unqualified !== key) {
      schema.set(unqualified, columns);
    }
  }

  return schema;
}

export function resolveSourceTypes(
  source: string,
  schema: Map<string, Map<string, string>>,
): string | undefined {
  const types: string[] = [];
  const pattern = /\b([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const [table, column] = match[1]!.split('.') as [string, string];
    const type = schema.get(table.toLowerCase())?.get(column.toLowerCase());
    if (type) types.push(type);
  }

  if (types.length === 0) {
    if (source === '按行计数') return 'BIGINT';
    return undefined;
  }
  return [...new Set(types)].join(' / ');
}
