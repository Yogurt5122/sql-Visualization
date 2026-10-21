import type { Clause } from '../../types';
import type { RuleDefinition, RuleMatch } from '../types';
import { collectFunctionCalls, hasColumnArgument, isAggregateFunction } from '../helpers';

const CONTEXT_KINDS = new Set(['select', 'where', 'join', 'groupBy', 'orderBy', 'having']);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export const repeatedComputationRule: RuleDefinition = {
  id: 'RSK-15',
  name: '同一个表达式算了两遍',
  severity: 'low',
  category: 'performance',
  confidence: 'medium',
  detail:
    '同一个函数表达式在 SELECT / WHERE / GROUP BY / ORDER BY / HAVING 里重复出现，数据库可能要算多次，SQL 也更难维护。',
  suggestion: '抽成 CTE 或子查询的计算列，外层直接引用。',
  detect({ statement }) {
    const occurrences = new Map<
      string,
      { text: string; count: number; clause: Clause }
    >();

    for (const clause of statement.clauses) {
      if (!CONTEXT_KINDS.has(clause.kind)) continue;
      for (const call of collectFunctionCalls(clause.text)) {
        if (isAggregateFunction(call.name) || !hasColumnArgument(call.args)) continue;
        const key = normalize(call.text);
        const existing = occurrences.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          occurrences.set(key, { text: call.text, count: 1, clause });
        }
      }
    }

    const matches: RuleMatch[] = [];
    for (const item of occurrences.values()) {
      if (item.count < 2) continue;
      matches.push({
        clauseId: item.clause.id,
        span: item.clause.span,
        detail: `表达式 ${item.text} 出现了 ${item.count} 次；可以抽成计算列复用。`,
      });
    }
    return matches;
  },
};
