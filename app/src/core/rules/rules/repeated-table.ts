import type { RuleDefinition, RuleMatch } from '../types';
import { findClauseAtLine, flattenSemanticQueries } from '../helpers';

export const repeatedTableRule: RuleDefinition = {
  id: 'RSK-05',
  name: '同一张表被重复扫描',
  severity: 'medium',
  category: 'performance',
  confidence: 'high',
  detail:
    '同一张物理表在一个语句里被多次读取，可能重复扫描大表；自连接和多层子查询里尤其常见。',
  suggestion: '能合并就合并；必须先聚合再关联时，考虑先落 CTE / 临时结果。',
  detect({ statement, semantic }) {
    if (!semantic) return [];

    const counts = new Map<string, { name: string; count: number; line: number }>();
    for (const query of flattenSemanticQueries(semantic)) {
      for (const source of query.sources) {
        if (source.kind !== 'table') continue;
        const key = source.name.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { name: source.name, count: 1, line: source.line });
        }
      }
    }

    const repeated = [...counts.values()]
      .filter((item) => item.count > 1)
      .sort((a, b) => b.count - a.count);
    if (repeated.length === 0) return [];

    const first = repeated[0]!;
    const anchor = findClauseAtLine(statement, first.line);
    const matches: RuleMatch[] = [
      {
        clauseId: anchor?.id,
        span: anchor?.span,
        detail: `表 ${first.name} 在语句里被读取了 ${first.count} 次；如果是大表，重复扫描的成本会叠加。`,
      },
    ];
    return matches;
  },
};
