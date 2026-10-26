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
