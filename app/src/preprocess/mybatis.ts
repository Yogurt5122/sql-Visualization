import type { MybatisVariant, PreprocessInfo } from '../core/types';

export interface PreprocessResult extends PreprocessInfo {
  sql: string;
}

const KNOWN_TAGS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'if',
  'choose',
  'when',
  'otherwise',
  'where',
  'set',
  'trim',
  'foreach',
  'include',
  'sql',
]);

interface Tag {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function scanTags(sql: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== '<') {
      i += 1;
      continue;
    }

    const next = sql[i + 1];
    if (!next || !/[A-Za-z/]/.test(next)) {
      i += 1;
      continue;
    }

    let j = i + 1;
    let quote: string | null = null;
    while (j < sql.length) {
      const ch = sql[j]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        j += 1;
        break;
      }
      j += 1;
    }

    const raw = sql.slice(i, j);
    const match = /^<\/?\s*([A-Za-z_][\w.-]*)/.exec(raw);
    if (!match) {
      i += 1;
      continue;
    }

    const name = match[1]!.toLowerCase();
    if (!KNOWN_TAGS.has(name)) {
      i += 1;
      continue;
    }

    tags.push({
      start: i,
      end: j,
      name,
      closing: /^<\//.test(raw),
      selfClosing: /\/>\s*$/.test(raw),
      attrs: parseAttrs(raw),
    });
    i = j;
  }

  return tags;
}

function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
}

function writeKeyword(
  chars: string[],
  start: number,
  end: number,
  keyword: string,
): void {
  if (end - start < keyword.length) return;
  for (let i = 0; i < keyword.length; i++) {
    chars[start + i] = keyword[i]!;
  }
}

function blankWordBefore(chars: string[], position: number): void {
  let end = position;
  while (end > 0 && /\s/.test(chars[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z]/.test(chars[start - 1]!)) start -= 1;
  const word = chars.slice(start, end).join('').toUpperCase();
  if (word === 'AND' || word === 'OR') blank(chars, start, end);
}

function blankLeadingConnector(chars: string[], from: number): void {
  let i = from;
  while (i < chars.length && /\s/.test(chars[i]!)) i += 1;
  let end = i;
  while (end < chars.length && /[A-Za-z]/.test(chars[end]!)) end += 1;
  const word = chars.slice(i, end).join('').toUpperCase();
  if (word === 'AND' || word === 'OR') blank(chars, i, end);
}

function blankTrailingComma(chars: string[], before: number): void {
  let i = before - 1;
  while (i >= 0 && /\s/.test(chars[i]!)) i -= 1;
  if (chars[i] === ',') chars[i] = ' ';
}

/**
 * 把 #{...} 变成等长的 "?    "，
 * 既保住 offset / 行号，又能让语义解析器把它当成普通占位符。
 */
function blankHashParams(chars: string[]): void {
  for (let i = 0; i < chars.length - 1; i++) {
    if (chars[i] !== '#' || chars[i + 1] !== '{') continue;
    let end = i + 2;
    while (end < chars.length && chars[end] !== '}') end += 1;
    if (end >= chars.length) continue;
    chars[i] = '?';
    for (let j = i + 1; j <= end; j++) {
      if (chars[j] !== '\n' && chars[j] !== '\r') chars[j] = ' ';
    }
    i = end;
  }
}

export function preprocessMyBatis(
  rawSql: string,
  variant: MybatisVariant = 'all',
): PreprocessResult {
  const tags = scanTags(rawSql);
  if (tags.length === 0) {
    return {
      sql: rawSql,
      detected: false,
      tags: [],
      dynamicConditions: 0,
      variant,
      warnings: [],
    };
  }

  const chars = rawSql.split('');
  const warnings: string[] = [];
  const names = new Set(tags.map((tag) => tag.name));
  const dynamicConditions = tags.filter(
    (tag) => !tag.closing && (tag.name === 'if' || tag.name === 'when'),
  ).length;

  if (names.has('include') || names.has('sql')) {
    warnings.push('包含 <include> / <sql> 片段，内容未提供时会标注「片段未知」。');
  }
  if (names.has('foreach')) {
    warnings.push('<foreach> 按一次占位展开，实际执行时是列表。');
  }

  if (variant === 'none') {
    const stack: Tag[] = [];
    for (const tag of tags) {
      if (tag.closing) {
        const index = stack.map((item) => item.name).lastIndexOf(tag.name);
        if (index >= 0) {
          const open = stack[index]!;
          stack.splice(index, 1);
          if (tag.name === 'if' || tag.name === 'when') {
            blank(chars, open.start, tag.end);
            blankWordBefore(chars, open.start);
          }
        }
      } else if (!tag.selfClosing) {
        stack.push(tag);
      }
    }
  }

  for (const tag of tags) {
    blank(chars, tag.start, tag.end);
  }

  // 标签先全部置空，再处理 where / set / trim 的连接符，
  // 否则中间夹着 <if> 标签时看不到真正的 AND / OR
  for (const tag of tags) {
    if (tag.closing) {
      if (tag.name === 'set') blankTrailingComma(chars, tag.start);
      if (tag.name === 'trim' && (tag.attrs.suffixoverrides ?? '').includes(',')) {
        blankTrailingComma(chars, tag.start);
      }
      continue;
    }

    if (tag.name === 'where') {
      writeKeyword(chars, tag.start, tag.end, 'WHERE');
      blankLeadingConnector(chars, tag.end);
    }
    if (tag.name === 'set') {
      writeKeyword(chars, tag.start, tag.end, 'SET');
    }
    if (tag.name === 'trim') {
      const prefix = (tag.attrs.prefix ?? '').toUpperCase();
      if (prefix) writeKeyword(chars, tag.start, tag.end, prefix);
      const overrides = (tag.attrs.prefixoverrides ?? '').toUpperCase();
      if (overrides.includes('AND') || overrides.includes('OR')) {
        blankLeadingConnector(chars, tag.end);
      }
    }
  }

  blankHashParams(chars);

  return {
    sql: chars.join(''),
    detected: true,
    tags: [...names].sort(),
    dynamicConditions,
    variant,
    warnings,
  };
}
