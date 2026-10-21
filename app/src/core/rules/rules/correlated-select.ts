import type { RuleDefinition } from '../types';
import { findClause, findClauseAtLine, flattenSemanticQueries } from '../helpers';

export const correlatedSelectRule: RuleDefinition = {
  id: 'RSK-12',
  name: 'SELECT 里有相关子查询',
  severity: 'high',
  category: 'performance',
  confidence: 'high',
  detail:
    'SELECT 列表里的相关子查询可能对每一行都执行一次；数据量大时，成本会按外层行数放大。',
  suggestion: '改成 JOIN / 聚合后关联，或先按关联键聚合到临时结果再取。',
  detect({ statement, semantic }) {
    if (!semantic) return [];

    const targets = flattenSemanticQueries(semantic).filter(
      (query) =>
        query.kind === 'subquery' &&
        query.origin === 'select' &&
        query.correlated === true,
    );
    if (targets.length === 0) return [];

    const select = findClause(statement, 'select');
    const first = targets[0]!;
    const anchor = select ?? findClauseAtLine(statement, first.startLine);
    return [
      {
        clauseId: anchor?.id,
        span: anchor?.span,
        detail: `SELECT 列表里有 ${targets.length} 个相关子查询；它们可能对每一行都执行一次。`,
      },
    ];
  },
};
