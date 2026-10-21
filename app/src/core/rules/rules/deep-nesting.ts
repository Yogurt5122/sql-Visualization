import type { RuleDefinition } from '../types';
import { findClauseAtLine, flattenSemanticQueries } from '../helpers';

export const deepNestingRule: RuleDefinition = {
  id: 'RSK-10',
  name: '查询嵌套过深',
  severity: 'medium',
  category: 'structure',
  confidence: 'high',
  detail:
    '子查询嵌套到 3 层以上时，读和改的成本都会明显上升，优化器也更容易选错计划。',
  suggestion: '把中间结果拆成 CTE，按步骤命名，减少一次性嵌套。',
  detect({ statement, semantic }) {
    if (!semantic) return [];

    const queries = flattenSemanticQueries(semantic);
    const maxDepth = Math.max(...queries.map((query) => query.depth));
    if (maxDepth < 3) return [];

    const deepest = queries.find((query) => query.depth === maxDepth);
    const anchor = findClauseAtLine(statement, deepest?.startLine ?? statement.span.startLine);
    return [
      {
        clauseId: anchor?.id,
        span: anchor?.span,
        detail: `最大查询嵌套为 ${maxDepth} 层；建议把中间结果拆成 CTE。`,
      },
    ];
  },
};
