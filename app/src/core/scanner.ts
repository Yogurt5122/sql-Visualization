import type { ScanError, Token, TokenKind } from './types';

export interface ScanResult {
  tokens: Token[];
  errors: ScanError[];
}

const KEYWORDS = new Set(
  `add all alter and any as asc auto_increment begin between bigint blob boolean by case cast char check
   clob column connect constraint create cross current database date day decimal declare default delete
   desc distinct double drop dual else end escape except exists explain fetch first float following for
   foreign from full grant group having identity if ilike in index inner insert int integer intersect into
   is join key language last lateral left like limit loop matched merge minus natural nchar next nocycle
   not null nulls number numeric nvarchar offset on only or order outer over partition primary prior
   qualify range recursive references returning right rownum row rows select serial set smallint some
   start table then ties timestamp to top true union unique update using values varchar varchar2 view
   when where while window with`
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase()),
);

const OPERATORS_3 = ['->>', '<=>'];
const OPERATORS_2 = ['<=', '>=', '<>', '!=', '||', '::', '->', ':=', '!<', '!>'];

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === '_' ||
    code >= 0x80
  );
}

function isIdentPart(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    isIdentStart(ch) ||
    (code >= 48 && code <= 57) ||
    ch === '$'
  );
}

/**
 * 线性扫描，永不抛异常。未闭合的字符串/注释/括号会记录到 errors，
 * 但 token 流仍然产出，保证上层可以降级。
 */
export function scan(sql: string): ScanResult {
  const tokens: Token[] = [];
  const errors: ScanError[] = [];
  const len = sql.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let depth = 0;
  const openParens: Array<{ offset: number; line: number; col: number }> = [];

  const advance = (end: number): void => {
    for (let k = i; k < end; k++) {
      if (sql.charCodeAt(k) === 10) {
        line += 1;
        lineStart = k + 1;
      }
    }
    i = end;
  };

  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    startLine: number,
    startCol: number,
    tokenDepth: number,
  ): void => {
    tokens.push({
      kind,
      text: sql.slice(start, end),
      start,
      end,
      line: startLine,
      col: startCol,
      depth: tokenDepth,
    });
  };

  while (i < len) {
    const start = i;
    const startLine = line;
    const startCol = i - lineStart + 1;
    const ch = sql[i]!;

    if (ch === '\n' || ch === '\r') {
      advance(i + 1);
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      advance(i + 1);
      continue;
    }

    // ---- 注释 ----
    if (ch === '-' && sql[i + 1] === '-') {
      let end = i + 2;
      while (end < len && sql[end] !== '\n') end++;
      push('comment', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    if (ch === '#') {
      if (sql[i + 1] === '{') {
        let end = i + 2;
        while (end < len && sql[end] !== '}') end++;
        if (end < len) end += 1;
        push('param', start, end, startLine, startCol, depth);
        advance(end);
        continue;
      }
      let end = i + 1;
      while (end < len && sql[end] !== '\n') end++;
      push('comment', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      let level = 1;
      while (j < len && level > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          level += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          level -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      const end = Math.min(j, len);
      if (level > 0) {
        errors.push({
          message: '块注释未闭合',
          offset: start,
          line: startLine,
          col: startCol,
        });
      }
      push('comment', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    // ---- 字符串与引用标识符 ----
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (sql[j] === '\\' && j + 1 < len) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      const end = Math.min(j, len);
      if (!closed) {
        errors.push({
          message: '字符串未闭合',
          offset: start,
          line: startLine,
          col: startCol,
        });
      }
      push('string', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    if (ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      const end = Math.min(j, len);
      if (!closed) {
        errors.push({
          message: quote === '"' ? '双引号标识符未闭合' : '反引号标识符未闭合',
          offset: start,
          line: startLine,
          col: startCol,
        });
      }
      push('quotedIdent', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (sql[j] === ']') {
          if (sql[j + 1] === ']') {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      const end = Math.min(j, len);
      if (!closed) {
        errors.push({
          message: '方括号标识符未闭合',
          offset: start,
          line: startLine,
          col: startCol,
        });
      }
      push('quotedIdent', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    // PostgreSQL dollar-quoted string
    if (ch === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close >= 0 ? close + tag.length : len;
        if (close < 0) {
          errors.push({
            message: '美元引用字符串未闭合',
            offset: start,
            line: startLine,
            col: startCol,
          });
        }
        push('string', start, end, startLine, startCol, depth);
        advance(end);
        continue;
      }
    }

    // ---- 参数占位符 ----
    if (ch === '?') {
      push('param', start, start + 1, startLine, startCol, depth);
      advance(start + 1);
      continue;
    }

    if (ch === ':' && isIdentStart(sql[i + 1])) {
      let j = i + 2;
      while (j < len && isIdentPart(sql[j])) j++;
      push('param', start, j, startLine, startCol, depth);
      advance(j);
      continue;
    }

    if (ch === '@') {
      let j = i + 1;
      if (sql[j] === '@') j += 1;
      if (isIdentStart(sql[j])) {
        while (j < len && isIdentPart(sql[j])) j++;
        push('param', start, j, startLine, startCol, depth);
        advance(j);
        continue;
      }
    }

    if (ch === '$' && sql[i + 1] === '{') {
      let j = i + 2;
      while (j < len && sql[j] !== '}') j++;
      if (j < len) j += 1;
      push('param', start, j, startLine, startCol, depth);
      advance(j);
      continue;
    }

    // ---- 数字 ----
    if (isDigit(ch) || (ch === '.' && isDigit(sql[i + 1]))) {
      const match =
        /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(sql.slice(i));
      const end = i + (match ? match[0].length : 1);
      push('number', start, end, startLine, startCol, depth);
      advance(end);
      continue;
    }

    // ---- 标识符 / 关键字 ----
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < len && isIdentPart(sql[j])) j++;
      const text = sql.slice(i, j);
      const kind: TokenKind = KEYWORDS.has(text.toUpperCase()) ? 'keyword' : 'ident';
      push(kind, start, j, startLine, startCol, depth);
      advance(j);
      continue;
    }

    // ---- 运算符 ----
    const three = sql.slice(i, i + 3);
    if (OPERATORS_3.includes(three)) {
      push('operator', start, start + 3, startLine, startCol, depth);
      advance(start + 3);
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (OPERATORS_2.includes(two)) {
      push('operator', start, start + 2, startLine, startCol, depth);
      advance(start + 2);
      continue;
    }
    if ('+-*/%<>=~!&|^'.includes(ch)) {
      push('operator', start, start + 1, startLine, startCol, depth);
      advance(start + 1);
      continue;
    }

    // ---- 括号 ----
    if (ch === '(') {
      push('punct', start, start + 1, startLine, startCol, depth);
      openParens.push({ offset: start, line: startLine, col: startCol });
      depth += 1;
      advance(start + 1);
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      const open = openParens.pop();
      if (!open) {
        errors.push({
          message: '多余的右括号',
          offset: start,
          line: startLine,
          col: startCol,
        });
      }
      push('punct', start, start + 1, startLine, startCol, depth);
      advance(start + 1);
      continue;
    }

    // ---- 其他标点 ----
    if ('.,;]'.includes(ch)) {
      push('punct', start, start + 1, startLine, startCol, depth);
      advance(start + 1);
      continue;
    }

    push('other', start, start + 1, startLine, startCol, depth);
    advance(start + 1);
  }

  if (openParens.length > 0) {
    const first = openParens[0]!;
    errors.push({
      message: `括号未闭合（还有 ${openParens.length} 个左括号）`,
      offset: first.offset,
      line: first.line,
      col: first.col,
    });
  }

  return { tokens, errors };
}
