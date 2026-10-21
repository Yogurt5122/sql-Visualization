import type { RuleDefinition } from '../types';
import { findClause } from '../helpers';

export const dm8RownumOrderRule: RuleDefinition = {
  id: 'RSK-16',
  name: 'ROWNUM 与 ORDER BY 同层，取到的不是「前 N 名」',
  severity: 'high',
  category: 'dm8',
  confidence: 'high',
  detail:
    'DM8 会先给行编号、再排序。想取排序后的前 N 行，需要先在子查询里排序，外层再限制 ROWNUM。',
  suggestion: '把 ORDER BY 放进子查询，外层再写 ROWNUM <= N。',
  detect({ statement, dialect }) {
    if (dialect !== 'dm8') return [];
    if (!/\bROWNUM\b/i.test(statement.text) || !/\bROWNUM\s*(<=|<|=)/i.test(statement.text)) {
      return [];
    }
    if (!findClause(statement, 'orderBy')) return [];

    const rownumClause =
      statement.clauses.find((clause) => /\bROWNUM\b/i.test(clause.text)) ??
      findClause(statement, 'where');
    return [{ clauseId: rownumClause?.id, span: rownumClause?.span }];
  },
};
