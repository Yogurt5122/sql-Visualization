import type { RuleDefinition } from '../types';
import { parseSelectItems } from '../helpers';

export const selectStarRule: RuleDefinition = {
  id: 'RSK-01',
  name: 'SELECT * 会带出全部字段',
  severity: 'medium',
  category: 'structure',
  confidence: 'high',
  detail: '字段数量取决于表结构；如果下游依赖列顺序，表结构一变就可能出问题。',
  suggestion: '显式写出需要的列，避免下游依赖列顺序。',
  detect({ statement }) {
    const matches = [];
    for (const clause of statement.clauses) {
      if (clause.kind !== 'select') continue;
      const hasStar = parseSelectItems(clause).some(
        (item) => item.trim() === '*' || /^[A-Za-z_]\w*\.\*$/.test(item.trim()),
      );
      if (hasStar) {
        matches.push({ clauseId: clause.id, span: clause.span });
      }
    }
    return matches;
  },
};
