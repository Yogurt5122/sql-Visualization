import type { RuleDefinition, RuleMatch } from '../types';
import type { SemanticQuery } from '../../types';
import { findClause } from '../helpers';

function flattenQueries(query: SemanticQuery, result: SemanticQuery[] = []): SemanticQuery[] {
  result.push(query);
  for (const cte of query.ctes) flattenQueries(cte.query, result);
  for (const subquery of query.subqueries) flattenQueries(subquery, result);
  return result;
}

export const subqueryOrderWithoutLimitRule: RuleDefinition = {
  id: 'RSK-06',
  name: '子查询 ORDER BY 没有 LIMIT',
  severity: 'low',
  category: 'performance',
  confidence: 'high',
  detail:
    '子查询里的 ORDER BY 如果不需要保证顺序，可能被优化器忽略；如果确实要前 N 行，应该补 LIMIT。',
  suggestion: '不需要顺序就删掉 ORDER BY；需要前 N 行就加 LIMIT。',
  detect({ statement, semantic }) {
    if (!semantic) return [];
    const matches: RuleMatch[] = [];

    for (const query of flattenQueries(semantic)) {
      if (query.kind !== 'subquery') continue;
      if (query.orderBy.length === 0 || query.limit) continue;

      const anchor =
        statement.clauses.find(
          (clause) =>
            clause.span.startLine <= query.startLine &&
            clause.span.endLine >= query.startLine,
        ) ?? findClause(statement, 'from') ?? statement.clauses[0];

      matches.push({
        clauseId: anchor?.id,
        span: anchor?.span,
        detail: `第 ${query.startLine} 行开始的子查询有 ORDER BY，但没有 LIMIT；如果不需要顺序，排序是白做的。`,
      });
    }

    return matches;
  },
};
