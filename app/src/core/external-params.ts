import { scan } from './scanner';

export interface ExternalParameter {
  name: string;
  raw: string;
  line: number;
  start: number;
  end: number;
}

const PARAMETER_PATTERN = /<!([A-Za-z_][A-Za-z0-9_.-]*)!>/g;

export function externalParameterName(text: string): string | undefined {
  const trimmed = text.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  const body = quoted ? quoted[2]! : trimmed;
  const match = /^<!([A-Za-z_][A-Za-z0-9_.-]*)!>$/.exec(body);
  return match?.[1];
}

export function externalParameterNamesIn(text: string): string[] {
  const names = new Set<string>();
  const pattern = /<!([A-Za-z_][A-Za-z0-9_.-]*)!>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) names.add(match[1]!);
  return [...names];
}

/** 收集 SQL 字符串里 <!name!> 形式的外部参数，保留行号与原文位置。 */
export function collectExternalParameters(sql: string): ExternalParameter[] {
  const { tokens } = scan(sql);
  const result: ExternalParameter[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.kind !== 'string' && token.kind !== 'ident') continue;
    const text = sql.slice(token.start, token.end);
    const local = text.match(PARAMETER_PATTERN);
    if (!local) continue;

    PARAMETER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PARAMETER_PATTERN.exec(text))) {
      const name = match[1]!;
      const absolute = token.start + match.index;
      const key = `${name}:${absolute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = text.slice(0, match.index);
      result.push({
        name,
        raw: match[0],
        line: token.line + (before.match(/\n/g)?.length ?? 0),
        start: absolute,
        end: absolute + match[0].length,
      });
    }
  }

  return result;
}

/** 把 SQL 片段里的参数占位符换成人能读的说明，不改变真实 SQL。 */
export function annotateExternalParameters(text: string): string {
  return text.replace(/['"]?<!([A-Za-z_][A-Za-z0-9_.-]*)!>['"]?/g, '外部参数 $1');
}
