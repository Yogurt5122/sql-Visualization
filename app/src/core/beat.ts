export type BeatTokenKind = 'keyword' | 'string' | 'comment' | 'punct' | 'word';

export interface BeatToken {
  id: string;
  text: string;
  line: number;
  kind: BeatTokenKind;
  /** 达到这一拳后开始悬挂，再挨一拳掉落。 */
  fallAt: number;
  hangAngle: number;
  fallX: number;
  fallRotate: number;
}

export interface BeatLine {
  line: number;
  tokens: BeatToken[];
}

const KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'OUTER',
  'CROSS',
  'ON',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'WITH',
  'AS',
  'UNION',
  'ALL',
  'DISTINCT',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'NULL',
  'IS',
  'INSERT',
  'UPDATE',
  'DELETE',
  'INTO',
  'VALUES',
]);

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function tokenKind(text: string): BeatTokenKind {
  if (text.startsWith('--') || text.startsWith('/*')) return 'comment';
  if (text.startsWith("'") || text.startsWith('"')) return 'string';
  if (KEYWORDS.has(text.toUpperCase())) return 'keyword';
  if (/^[(),.;=<>+\-*/%]+$/.test(text)) return 'punct';
  return 'word';
}

/** 平均每两行三拳，短 SQL 至少 9 拳，长 SQL 最多 60 拳。 */
export function beatToughness(lineCount: number): number {
  return Math.max(9, Math.min(60, Math.round(Math.max(1, lineCount) * 1.5)));
}

export function buildBeatLines(sql: string): BeatLine[] {
  const rawLines = sql.split('\n');
  const toughness = beatToughness(rawLines.length);
  const flat: Array<{ line: number; text: string; index: number }> = [];

  rawLines.forEach((text, lineIndex) => {
    const words = text.match(/\S+/g) ?? [];
    for (const word of words) {
      flat.push({ line: lineIndex + 1, text: word, index: flat.length });
    }
  });

  const span = Math.max(1, toughness - 4);
  const tokens = new Map<number, BeatToken>();
  for (const [index, item] of flat.entries()) {
    const seed = hash(`${item.line}:${index}:${item.text}`);
    const base = 3 + Math.floor((index / Math.max(1, flat.length - 1)) * span);
    const jitter = index === 0 ? 0 : (seed % 3) - 1;
    tokens.set(item.index, {
      id: `${item.line}-${index}`,
      text: item.text,
      line: item.line,
      kind: tokenKind(item.text),
      fallAt: Math.max(3, Math.min(toughness, base + jitter)),
      hangAngle: ((seed % 41) - 20) / 1.6,
      fallX: ((seed % 241) - 120) / 2,
      fallRotate: ((seed % 481) - 240) / 1.8,
    });
  }

  return rawLines.map((_, index) => ({
    line: index + 1,
    tokens: flat
      .filter((item) => item.line === index + 1)
      .map((item) => tokens.get(item.index)!),
  }));
}
