import type { RuleDefinition } from '../types';
import { findClause } from '../helpers';

export const distinctWithJoinRule: RuleDefinition = {
  id: 'RSK-07',
  name: 'DISTINCT 可能只是在掩盖 JOIN 放大',
  severity: 'medium',
  category: 'performance',
  confidence: 'medium',
  detail:
    'JOIN 之后出现重复行，再用 DISTINCT 去重，会让数据库多做一次排序 / 临时表；如果连接基数不对，结果行数也可能被放大。',
  suggestion: '先确认 JOIN 的基数；能通过连接条件收口时，不要用 DISTINCT 兜底。',
  detect({ statement, relations }) {
    const select = findClause(statement, 'select');
    if (!select || !/\bSELECT\s+DISTINCT\b/i.test(select.text)) return [];

    const hasJoin = statement.clauses.some((clause) => clause.kind === 'join');
    if (!hasJoin && relations.sources.length <= 1) return [];

    return [{ clauseId: select.id, span: select.span }];
  },
};
