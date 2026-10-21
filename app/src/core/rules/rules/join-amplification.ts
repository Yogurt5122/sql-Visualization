import type { RuleDefinition } from '../types';
import { findClause, findClauseAtLine, flattenSemanticQueries } from '../helpers';

const LOW_CARDINALITY = new Set([
  'status',
  'state',
  'type',
  'kind',
  'flag',
  'category',
  'level',
  'stage',
]);

function columnName(label: string): string {
  return label.split('.').pop()?.replace(/["`[\]]/g, '').toLowerCase() ?? '';
}

export const joinAmplificationRule: RuleDefinition = {
  id: 'RSK-14',
  name: 'JOIN 可能放大聚合结果',
  severity: 'high',
  category: 'performance',
  confidence: 'low',
  detail:
    'JOIN 键看起来是低基数列（status / type / flag 等），又在外层做 SUM / COUNT 时，可能发生 1:N 放大，导致指标重复计算。',
  suggestion: '确认连接键是否唯一；先按关联键聚合，再 JOIN，或补上唯一键条件。',
  detect({ statement, semantic }) {
    if (!semantic) return [];

    for (const query of flattenSemanticQueries(semantic)) {
      if (!query.hasAggregate) continue;
      const key = query.joinKeys.find(
        (item) =>
          LOW_CARDINALITY.has(columnName(item.left)) ||
          LOW_CARDINALITY.has(columnName(item.right)),
      );
      if (!key) continue;

      const anchor =
        findClauseAtLine(statement, key.line) ?? findClause(statement, 'join');
      return [
        {
          clauseId: anchor?.id,
          span: anchor?.span,
          detail: `连接键 ${key.left} = ${key.right} 是低基数列，外层又有聚合；如果是一对多，SUM / COUNT 会重复计算。请确认连接键的唯一性。`,
        },
      ];
    }

    return [];
  },
};
