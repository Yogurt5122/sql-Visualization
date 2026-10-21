import type { RuleDefinition, RuleMatch } from '../types';

const DATE_LITERAL =
  /(?:\bDATE\s*)?'(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)'/gi;

export const hardcodedDateRule: RuleDefinition = {
  id: 'RSK-09',
  name: '过滤条件里写死了日期',
  severity: 'low',
  category: 'semantic',
  confidence: 'medium',
  detail:
    'WHERE / JOIN / HAVING 里的日期字面量把时间范围固定死了；换一天就要改 SQL，也容易漏改。',
  suggestion: '改成绑定参数，或由调度系统传入日期变量。',
  detect({ statement }) {
    const matches: RuleMatch[] = [];

    for (const clause of statement.clauses) {
      if (clause.kind !== 'where' && clause.kind !== 'join' && clause.kind !== 'having') {
        continue;
      }
      const count = [...clause.text.matchAll(DATE_LITERAL)].length;
      if (count === 0) continue;

      matches.push({
        clauseId: clause.id,
        span: clause.span,
        detail: `这个条件里有 ${count} 处硬编码日期；换一天就要改 SQL，也容易漏改。`,
      });
    }

    return matches;
  },
};
