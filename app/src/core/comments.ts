import { scan } from './scanner';

export interface SqlComment {
  raw: string;
  text: string;
  line: number;
  start: number;
  end: number;
}

/** 收集 SQL 注释；注释仍保留原文，便于挂到对应解释。 */
export function collectSqlComments(sql: string): SqlComment[] {
  const { tokens } = scan(sql);
  return tokens
    .filter((token) => token.kind === 'comment')
    .map((token) => {
      const raw = sql.slice(token.start, token.end);
      const text = raw.startsWith('--')
        ? raw.slice(2).trim()
        : raw.replace(/^\/\*/, '').replace(/\*\/$/, '').trim();
      return { raw, text, line: token.line, start: token.start, end: token.end };
    });
}

/** 取节点范围内的注释，并带上紧邻节点前的连续注释。 */
export function commentsForRange(
  comments: SqlComment[],
  startLine: number,
  endLine: number,
): SqlComment[] {
  const inside = comments.filter(
    (comment) => comment.line >= startLine && comment.line <= endLine,
  );
  const before: SqlComment[] = [];
  let line = startLine - 1;
  while (line >= 1) {
    const match = comments.filter((comment) => comment.line === line);
    if (match.length === 0) break;
    before.unshift(...match);
    line -= 1;
  }
  return [...before, ...inside];
}
