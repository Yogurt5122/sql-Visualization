import type { RuleDefinition } from '../types';

function plusAliases(text: string): Set<string> {
  const aliases = new Set<string>();
  for (const match of text.matchAll(/([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*\(\+\)/g)) {
    aliases.add(match[1]!.toLowerCase());
  }
  return aliases;
}

function hasJoinCondition(text: string): boolean {
  return (
    /[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)\s*=\s*[A-Za-z_]\w*\.[A-Za-z_]\w*/.test(text) ||
    /[A-Za-z_]\w*\.[A-Za-z_]\w*\s*=\s*[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)/.test(text)
  );
}

function hasBothPlus(text: string): boolean {
  return /[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)\s*=\s*[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)/.test(
    text,
  );
}

function hasFilteredNullable(text: string, alias: string): boolean {
  const cleaned = text
    .replace(
      /[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)\s*=\s*[A-Za-z_]\w*\.[A-Za-z_]\w*/g,
      ' ',
    )
    .replace(
      /[A-Za-z_]\w*\.[A-Za-z_]\w*\s*=\s*[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(\+\)/g,
      ' ',
    );
  return new RegExp(
    `\\b${alias}\\.[A-Za-z_]\\w*\\s*(?:=|<>|!=|>=|<=|>|<|LIKE\\b|IN\\b)`,
    'i',
  ).test(cleaned);
}

export const plusWrongSideRule: RuleDefinition = {
  id: 'RSK-17',
  name: 'DM8 (+) 的位置可能有问题',
  severity: 'high',
  category: 'dm8',
  confidence: 'high',
  detail:
    '`(+)` 标在可空侧。两侧都写 `(+)`、可空侧又被 WHERE 过滤、或 `(+)` 不在连接条件里，都会让外连接结果和预期不一致。',
  suggestion: '确认保留侧和可空侧；只在一侧写 `(+)`，不要把可空侧再放进过滤条件。',
  detect({ statement, dialect }) {
    if (dialect !== 'dm8') return [];
    const whereClauses = statement.clauses.filter((clause) => clause.kind === 'where');
    if (whereClauses.length === 0) return [];

    const text = whereClauses.map((clause) => clause.text).join('\n');
    const aliases = plusAliases(text);
    if (aliases.size === 0) return [];

    const anchor = whereClauses[0]!;
    if (hasBothPlus(text)) {
      return [
        {
          clauseId: anchor.id,
          span: anchor.span,
          detail: '同一个比较两侧都写了 `(+)`，连接方向不明确，DM8 可能直接报错或得到非预期结果。',
        },
      ];
    }

    for (const alias of aliases) {
      if (hasFilteredNullable(text, alias)) {
        return [
          {
            clauseId: anchor.id,
            span: anchor.span,
            detail: `带 \`(+)\` 的可空侧 ${alias} 又被 WHERE 过滤；外连接会退化成内连接，可能把本该保留的行过滤掉。`,
          },
        ];
      }
    }

    if (!hasJoinCondition(text)) {
      return [
        {
          clauseId: anchor.id,
          span: anchor.span,
          detail: '`(+)` 没有出现在两表等值连接条件里；它可能被写在了普通过滤 / 比较条件上。',
        },
      ];
    }

    return [];
  },
};
