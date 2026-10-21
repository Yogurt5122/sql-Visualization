import type { Clause, Statement } from '../../types';
import type { RuleDefinition } from '../types';

function hasJoinConditionInWhere(statement: Statement, joinClause: Clause): boolean {
  const where = statement.clauses.find((clause) => clause.kind === 'where');
  if (!where) return false;

  const match =
    /\bJOIN\s+([A-Za-z_][\w$."`[\]]*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/i.exec(
      joinClause.text,
    );
  if (!match) return false;

  const table = match[1]!.split('.').pop()!.replace(/["`[\]]/g, '');
  const qualifier = (match[2] ?? table).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const other = '[A-Za-z_]\\w*';
  const pattern = new RegExp(
    `\\b${qualifier}\\.\\w+\\s*=\\s*(?!${qualifier}\\.)${other}\\.\\w+|\\b${other}\\.\\w+\\s*=\\s*${qualifier}\\.\\w+`,
    'i',
  );
  return pattern.test(where.text);
}

export const missingJoinConditionRule: RuleDefinition = {
  id: 'RSK-02',
  name: 'JOIN 缺少连接条件',
  severity: 'high',
  category: 'structure',
  confidence: 'high',
  detail:
    'JOIN 后没有 ON / USING，WHERE 里也没有把两边连起来的条件，结果行数等于两表行数相乘（笛卡尔积）。',
  suggestion: '补上 ON / USING，确认两边的连接键。',
  detect({ statement }) {
    const matches = [];
    for (const clause of statement.clauses) {
      if (
        clause.kind === 'join' &&
        !/\bON\b|\bUSING\b|\bCROSS\s+JOIN\b/i.test(clause.text) &&
        !hasJoinConditionInWhere(statement, clause)
      ) {
        matches.push({ clauseId: clause.id, span: clause.span });
      }
    }
    return matches;
  },
};
