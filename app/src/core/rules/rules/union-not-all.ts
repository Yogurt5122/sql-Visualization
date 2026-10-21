import type { RuleDefinition } from '../types';

export const unionNotAllRule: RuleDefinition = {
  id: 'RSK-08',
  name: 'UNION 可以去重，但代价更高',
  severity: 'low',
  category: 'performance',
  confidence: 'high',
  detail:
    'UNION 会对两个分支做去重排序；如果确认两边不会重复，UNION ALL 少一次去重。',
  suggestion: '确认两边结果不重复后，改成 UNION ALL。',
  detect({ statement }) {
    const matches = [];
    for (const clause of statement.clauses) {
      if (clause.kind === 'union' && /\bUNION\b(?!\s+ALL\b)/i.test(clause.text)) {
        matches.push({ clauseId: clause.id, span: clause.span });
      }
    }
    return matches;
  },
};
