import type { Relations } from '../core/types';

export const VISUAL_COLORS = [
  '#2563eb',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
];

const COLUMN_REF = /\b([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)\b/g;

export function sourceTables(source: string): string[] {
  if (/按行计数|常量|表达式/.test(source)) return ['计算值'];
  const tables = new Set<string>();
  let match: RegExpExecArray | null;
  COLUMN_REF.lastIndex = 0;
  while ((match = COLUMN_REF.exec(source))) {
    tables.add(match[1]!.split('.')[0]!);
  }
  return tables.size > 0 ? [...tables] : ['其他来源'];
}

export function sourceTable(source: string): string {
  return sourceTables(source)[0]!;
}

export function sourceColor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return VISUAL_COLORS[hash % VISUAL_COLORS.length]!;
}

export function collectSourceFields(relations: Relations): Map<string, string[]> {
  const result = new Map<string, Set<string>>();

  for (const row of relations.lineage) {
    let match: RegExpExecArray | null;
    COLUMN_REF.lastIndex = 0;
    while ((match = COLUMN_REF.exec(row.source))) {
      const [table, column] = match[1]!.split('.') as [string, string];
      const fields = result.get(table) ?? new Set<string>();
      fields.add(column);
      result.set(table, fields);
    }
  }

  return new Map(
    [...result.entries()]
      .map(([table, fields]) => [table, [...fields].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** 输出字段 + JOIN 条件里实际引用到的字段。 */
export function collectRelationFields(relations: Relations): Map<string, string[]> {
  const result = new Map(
    [...collectSourceFields(relations).entries()].map(([table, fields]) => [
      table,
      [...fields],
    ]),
  );
  const aliasMap = new Map<string, string>();
  for (const source of relations.sources) {
    aliasMap.set(source.name.toLowerCase(), source.name);
    if (source.alias) aliasMap.set(source.alias.toLowerCase(), source.name);
  }

  for (const join of relations.joins) {
    if (!join.condition) continue;
    for (const match of join.condition.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g)) {
      const table = aliasMap.get(match[1]!.toLowerCase());
      if (!table) continue;
      const fields = new Set(result.get(table) ?? []);
      fields.add(match[2]!);
      result.set(table, [...fields].sort());
    }
  }

  // DML 目标表的字段来自 lineage 的目标列，而不是来源字段。
  for (const source of relations.sources) {
    if (source.role !== 'target') continue;
    const fields = new Set(result.get(source.name) ?? []);
    for (const row of relations.lineage) {
      if (row.output && row.output !== '*') fields.add(row.output);
    }
    result.set(source.name, [...fields].sort());
  }

  return result;
}
