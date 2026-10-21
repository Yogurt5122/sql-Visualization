/**
 * SQL 文本的轻量工具：不依赖 DOM，也不依赖 AST。
 */

export function stripLeadingKeyword(text: string, keyword: string): string {
  const pattern = keyword.replace(/\s+/g, '\\s+');
  return text.replace(new RegExp(`^\\s*${pattern}\\b`, 'i'), '').trim();
}

/**
 * 按顶层分隔符切分。括号内、引号内的分隔符不切。
 */
export function splitTopLevel(text: string, separator: ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}
