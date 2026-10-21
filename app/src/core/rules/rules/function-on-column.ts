import type { RuleDefinition, RuleMatch } from '../types';
import { collectFunctionCalls, hasColumnArgument, isAggregateFunction } from '../helpers';

const CONTEXT_KINDS = new Set(['where', 'join', 'groupBy', 'orderBy']);

export const functionOnColumnRule: RuleDefinition = {
  id: 'RSK-03',
  name: '函数包住字段，索引可能用不上',
  severity: 'medium',
  category: 'performance',
  confidence: 'high',
  detail:
    'WHERE / JOIN / GROUP BY / ORDER BY 里把列放进函数后，数据库通常无法直接使用该列上的索引。',
  suggestion: '把函数移到常量侧，或改用范围条件；必须计算时考虑函数索引 / 生成列。',
  detect({ statement }) {
    const matches: RuleMatch[] = [];

    for (const clause of statement.clauses) {
      if (!CONTEXT_KINDS.has(clause.kind)) continue;
      const call = collectFunctionCalls(clause.text).find(
        (item) => !isAggregateFunction(item.name) && hasColumnArgument(item.args),
      );
      if (!call) continue;

      matches.push({
        clauseId: clause.id,
        span: clause.span,
        detail: `${call.name}() 把列包在函数里；数据库通常无法直接使用该列上的索引。`,
      });
    }

    return matches;
  },
};
