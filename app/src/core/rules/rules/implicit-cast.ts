import type { RuleDefinition, RuleMatch } from '../types';

const NUMERIC_HINT = /_(id|count|cnt|amount|amt|price|qty|quantity|num|age|score)$/i;
const TEXT_HINT = /_(code|name|phone|email|no)$/i;
const COLUMN = '([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)?)';
const QUOTED_NUMBER = new RegExp(`${COLUMN}\\s*=\\s*'(\\d+(?:\\.\\d+)?)'`, 'g');
const NUMERIC_LITERAL = new RegExp(`${COLUMN}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');

function columnName(label: string): string {
  return label.split('.').pop() ?? label;
}

export const implicitCastRule: RuleDefinition = {
  id: 'RSK-04',
  name: '列和字面量类型可能不一致',
  severity: 'medium',
  category: 'semantic',
  confidence: 'low',
  detail:
    '从列名和字面量看，列和值可能是不同类型；数据库做隐式转换后，索引可能失效，结果也可能不符合预期。',
  suggestion: '确认列类型，给值加正确的类型，或显式 CAST；不要依赖数据库隐式转换。',
  detect({ statement }) {
    const matches: RuleMatch[] = [];

    for (const clause of statement.clauses) {
      if (clause.kind !== 'where' && clause.kind !== 'join' && clause.kind !== 'having') {
        continue;
      }

      let found: { column: string; quoted: boolean; value: string } | undefined;

      for (const match of clause.text.matchAll(QUOTED_NUMBER)) {
        const column = match[1]!;
        if (NUMERIC_HINT.test(columnName(column))) {
          found = { column, quoted: true, value: match[2]! };
          break;
        }
      }

      if (!found) {
        for (const match of clause.text.matchAll(NUMERIC_LITERAL)) {
          const column = match[1]!;
          if (TEXT_HINT.test(columnName(column))) {
            found = { column, quoted: false, value: match[2]! };
            break;
          }
        }
      }

      if (!found) continue;
      matches.push({
        clauseId: clause.id,
        span: clause.span,
        detail: `列 ${found.column} 和字面量 ${found.quoted ? `'${found.value}'` : found.value} 的类型可能不一致；数据库做隐式转换后索引可能失效。请确认列类型。`,
      });
    }

    return matches;
  },
};
