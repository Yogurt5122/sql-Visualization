import type {
  Clause,
  ClauseKind,
  Span,
  Statement,
  StatementKind,
  Token,
} from './types';

const LABELS: Record<ClauseKind, string> = {
  with: 'WITH',
  select: 'SELECT',
  from: 'FROM',
  join: 'JOIN',
  where: 'WHERE',
  groupBy: 'GROUP BY',
  having: 'HAVING',
  orderBy: 'ORDER BY',
  limit: 'LIMIT',
  offset: 'OFFSET',
  union: 'UNION',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  other: '片段',
};

const JOIN_MODIFIERS = new Set([
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'CROSS',
  'NATURAL',
  'OUTER',
]);

type RawKind = ClauseKind | 'on';

interface Boundary {
  kind: RawKind;
  start: number;
  line: number;
  col: number;
}

interface ClauseBoundary {
  kind: ClauseKind;
  start: number;
  line: number;
  col: number;
}

function lineColAt(sql: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(offset, sql.length);
  for (let i = 0; i < limit; i++) {
    if (sql.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: Math.max(1, offset - lineStart + 1) };
}

function makeSpan(sql: string, start: number, end: number): Span {
  const from = lineColAt(sql, start);
  const to = lineColAt(sql, end);
  return {
    start,
    end,
    startLine: from.line,
    endLine: to.line,
    startCol: from.col,
    endCol: to.col,
  };
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function stableId(
  prefix: string,
  kind: string,
  line: number,
  col: number,
  text: string,
): string {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  return `${prefix}-${hashString(`${kind}:${line}:${col}:${normalized}`)}`;
}

function nextUpper(tokens: Token[], index: number): string | null {
  for (let i = index + 1; i < tokens.length; i++) {
    return tokens[i]!.text.toUpperCase();
  }
  return null;
}

function statementKind(tokens: Token[]): StatementKind {
  for (const token of tokens) {
    if (token.kind !== 'keyword') continue;
    switch (token.text.toUpperCase()) {
      case 'WITH':
      case 'SELECT':
        return 'select';
      case 'INSERT':
        return 'insert';
      case 'UPDATE':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'other';
    }
  }
  return 'other';
}

function detectBoundaries(tokens: Token[]): ClauseBoundary[] {
  const boundaries: Boundary[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'keyword' || token.depth !== 0) continue;

    const upper = token.text.toUpperCase();
    let kind: RawKind | null = null;
    let startToken = token;

    switch (upper) {
      case 'WITH':
        kind = 'with';
        break;
      case 'SELECT':
        kind = 'select';
        break;
      case 'FROM':
        kind = 'from';
        break;
      case 'JOIN':
        kind = 'join';
        // 把 LEFT / RIGHT / FULL / INNER / OUTER / CROSS / NATURAL 一起算进 JOIN
        for (let back = index - 1; back >= 0; back--) {
          const prev = tokens[back]!;
          if (prev.depth !== 0 || prev.kind !== 'keyword') break;
          if (!JOIN_MODIFIERS.has(prev.text.toUpperCase())) break;
          startToken = prev;
        }
        break;
      case 'ON':
        kind = 'on';
        break;
      case 'WHERE':
        kind = 'where';
        break;
      case 'HAVING':
        kind = 'having';
        break;
      case 'LIMIT':
        kind = 'limit';
        break;
      case 'OFFSET':
        kind = 'offset';
        break;
      case 'GROUP':
        if (nextUpper(tokens, index) === 'BY') kind = 'groupBy';
        break;
      case 'ORDER':
        if (nextUpper(tokens, index) === 'BY') kind = 'orderBy';
        break;
      case 'UNION':
      case 'INTERSECT':
      case 'EXCEPT':
      case 'MINUS':
        kind = 'union';
        break;
      case 'INSERT':
        kind = 'insert';
        break;
      case 'UPDATE':
        kind = 'update';
        break;
      case 'DELETE':
        kind = 'delete';
        break;
      default:
        break;
    }

    if (kind) {
      boundaries.push({
        kind,
        start: startToken.start,
        line: startToken.line,
        col: startToken.col,
      });
    }
  }

  // 合并 ON 到前一个 JOIN；DELETE FROM 合并到 DELETE
  const merged: ClauseBoundary[] = [];
  for (const boundary of boundaries) {
    const previous = merged[merged.length - 1];
    if (boundary.kind === 'on' && previous?.kind === 'join') {
      continue;
    }
    if (boundary.kind === 'from' && previous?.kind === 'delete') {
      continue;
    }
    if (previous && previous.start === boundary.start) {
      continue;
    }
    merged.push({
      kind: boundary.kind === 'on' ? 'other' : boundary.kind,
      start: boundary.start,
      line: boundary.line,
      col: boundary.col,
    });
  }

  return merged;
}

function splitClauses(
  sql: string,
  tokens: Token[],
  statementStart: number,
  statementEnd: number,
): Clause[] {
  const boundaries = detectBoundaries(tokens);
  const clauses: Clause[] = [];

  const pushClause = (kind: ClauseKind, start: number, end: number, line: number, col: number) => {
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(sql[trimmedEnd - 1]!)) trimmedEnd -= 1;
    const text = sql.slice(start, trimmedEnd);
    if (!text.trim()) return;
    clauses.push({
      id: stableId('c', kind, line, col, text),
      kind,
      label: LABELS[kind],
      span: makeSpan(sql, start, trimmedEnd),
      text,
    });
  };

  if (boundaries.length === 0) {
    const first = tokens[0]!;
    pushClause('other', statementStart, statementEnd, first.line, first.col);
    return clauses;
  }

  const firstBoundary = boundaries[0]!;
  if (firstBoundary.start > statementStart) {
    const prefix = sql.slice(statementStart, firstBoundary.start);
    if (prefix.trim()) {
      const pos = lineColAt(sql, statementStart);
      pushClause('other', statementStart, firstBoundary.start, pos.line, pos.col);
    }
  }

  for (let index = 0; index < boundaries.length; index++) {
    const boundary = boundaries[index]!;
    const nextStart =
      index + 1 < boundaries.length ? boundaries[index + 1]!.start : statementEnd;
    pushClause(boundary.kind, boundary.start, nextStart, boundary.line, boundary.col);
  }

  return clauses;
}

/**
 * 按 depth === 0 的 `;` 切分语句。字符串/注释/括号内的分号不会被误切。
 */
export function splitStatements(sql: string, tokens: Token[]): Statement[] {
  const significant = tokens.filter((token) => token.kind !== 'comment');
  const statements: Statement[] = [];
  let buffer: Token[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const first = buffer[0]!;
    const last = buffer[buffer.length - 1]!;
    const start = first.start;
    const end = last.end;
    const text = sql.slice(start, end);
    if (!text.trim()) {
      buffer = [];
      return;
    }
    const kind = statementKind(buffer);
    const clauses = splitClauses(sql, buffer, start, end);
    statements.push({
      id: stableId('s', kind, first.line, first.col, text),
      index: statements.length,
      kind,
      span: makeSpan(sql, start, end),
      text,
      clauses,
    });
    buffer = [];
  };

  for (const token of significant) {
    if (token.kind === 'punct' && token.text === ';' && token.depth === 0) {
      flush();
      continue;
    }
    buffer.push(token);
  }
  flush();

  return statements;
}
