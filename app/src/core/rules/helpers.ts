import type { Clause, ClauseKind, SemanticQuery, Statement } from '../types';
import { splitTopLevel, stripLeadingKeyword } from '../sql-text';

export function findClause(
  statement: Statement,
  kind: ClauseKind,
): Clause | undefined {
  return statement.clauses.find((clause) => clause.kind === kind);
}

export function findClauseAtLine(
  statement: Statement,
  line: number,
): Clause | undefined {
  return (
    statement.clauses.find(
      (clause) => clause.span.startLine <= line && clause.span.endLine >= line,
    ) ?? statement.clauses[0]
  );
}

export function flattenSemanticQueries(
  query: SemanticQuery,
  result: SemanticQuery[] = [],
): SemanticQuery[] {
  result.push(query);
  for (const cte of query.ctes) flattenSemanticQueries(cte.query, result);
  for (const subquery of query.subqueries) flattenSemanticQueries(subquery, result);
  return result;
}

export function parseSelectItems(clause: Clause): string[] {
  const body = stripLeadingKeyword(clause.text, 'SELECT').replace(/^DISTINCT\s+/i, '');
  return splitTopLevel(body, ',');
}

const KEYWORDS = new Set([
  'all',
  'and',
  'as',
  'asc',
  'by',
  'case',
  'cross',
  'current_date',
  'current_time',
  'current_timestamp',
  'date',
  'day',
  'delete',
  'desc',
  'distinct',
  'else',
  'end',
  'exists',
  'from',
  'full',
  'getdate',
  'group',
  'having',
  'hour',
  'in',
  'inner',
  'insert',
  'interval',
  'into',
  'join',
  'left',
  'limit',
  'minute',
  'month',
  'not',
  'now',
  'null',
  'on',
  'or',
  'order',
  'outer',
  'over',
  'partition',
  'right',
  'second',
  'select',
  'set',
  'sysdate',
  'then',
  'time',
  'timestamp',
  'union',
  'update',
  'using',
  'values',
  'when',
  'where',
  'year',
]);

const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);

const NON_FUNCTIONS = new Set([
  'all',
  'and',
  'as',
  'by',
  'case',
  'cross',
  'delete',
  'distinct',
  'else',
  'end',
  'exists',
  'filter',
  'from',
  'full',
  'group',
  'having',
  'in',
  'inner',
  'insert',
  'into',
  'join',
  'lateral',
  'left',
  'limit',
  'not',
  'on',
  'or',
  'order',
  'outer',
  'over',
  'partition',
  'right',
  'select',
  'set',
  'sets',
  'then',
  'union',
  'update',
  'using',
  'values',
  'when',
  'where',
  'window',
]);

export interface FunctionCall {
  name: string;
  text: string;
  args: string;
}

export function collectFunctionCalls(text: string): FunctionCall[] {
  const calls: FunctionCall[] = [];
  const pattern = /([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const name = match[1]!;
    if (NON_FUNCTIONS.has(name.toLowerCase())) continue;

    const open = match.index + match[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;

    for (let i = open; i < text.length; i++) {
      const char = text[i]!;
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end < 0) continue;
    calls.push({
      name,
      text: text.slice(match.index, end + 1),
      args: text.slice(open + 1, end),
    });
  }

  return calls;
}

export function hasColumnArgument(args: string): boolean {
  let value = args;
  for (let pass = 0; pass < 3; pass++) {
    value = value.replace(/[A-Za-z_]\w*\s*\([^()]*\)/g, ' ');
  }
  value = value.replace(/'([^']|'')*'/g, ' ').replace(/"[^"]*"/g, ' ');
  const tokens = value.match(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?/g) ?? [];
  return tokens.some((token) => !KEYWORDS.has(token.toLowerCase()));
}

export function isAggregateFunction(name: string): boolean {
  return AGGREGATES.has(name.toLowerCase());
}
