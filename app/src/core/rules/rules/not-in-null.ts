import type { RuleDefinition } from '../types';

export const notInNullRule: RuleDefinition = {
  id: 'RSK-11',
  name: 'NOT IN 可能因 NULL 返回空结果',
  severity: 'high',
  category: 'semantic',
  confidence: 'high',
  detail:
    '如果子查询结果里包含 NULL，NOT IN 的整体判断会变成 UNKNOWN，导致查不到任何行。',
  suggestion: '改成 NOT EXISTS，或在子查询里加 WHERE 列 IS NOT NULL。',
  detect({ statement }) {
    const matches = [];
    for (const clause of statement.clauses) {
      if (clause.kind === 'where' && /\bNOT\s+IN\s*\(/i.test(clause.text)) {
        matches.push({ clauseId: clause.id, span: clause.span });
      }
    }
    return matches;
  },
};
