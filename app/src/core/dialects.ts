import type { Dialect, ResolvedDialect } from './types';

export const DIALECT_OPTIONS: Array<{ id: Dialect; label: string }> = [
  { id: 'auto', label: '自动识别' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'tsql', label: 'SQL Server' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'dm8', label: '达梦 DM8' },
];

export const DIALECT_LABEL: Record<ResolvedDialect, string> = {
  mysql: 'MySQL',
  tsql: 'SQL Server',
  postgres: 'PostgreSQL',
  dm8: '达梦 DM8',
};

export interface DialectGuess {
  dialect: ResolvedDialect;
  confidence: number;
  evidence: string[];
}

interface Feature {
  re: RegExp;
  weight: number;
  evidence: string;
}

const FEATURES: Record<ResolvedDialect, Feature[]> = {
  mysql: [
    { re: /`[^`]+`/g, weight: 2, evidence: '反引号标识符' },
    { re: /\bLIMIT\s+\d+/gi, weight: 1, evidence: 'LIMIT 分页' },
    { re: /\bAUTO_INCREMENT\b/gi, weight: 2, evidence: 'AUTO_INCREMENT' },
    { re: /\bGROUP_CONCAT\s*\(/gi, weight: 2, evidence: 'GROUP_CONCAT' },
    { re: /^\s*#/gm, weight: 1, evidence: '# 行注释' },
    { re: /\bON\s+DUPLICATE\s+KEY\b/gi, weight: 3, evidence: 'ON DUPLICATE KEY' },
  ],
  tsql: [
    { re: /\bTOP\s*\(?\s*\d+/gi, weight: 2, evidence: 'TOP' },
    { re: /\[[A-Za-z_][^\]]*\]/g, weight: 2, evidence: '方括号标识符' },
    { re: /^\s*GO\s*;?\s*$/gim, weight: 2, evidence: 'GO 批处理' },
    { re: /\bISNULL\s*\(/gi, weight: 1, evidence: 'ISNULL' },
    { re: /\bNVARCHAR\b/gi, weight: 1, evidence: 'NVARCHAR' },
    { re: /@@[A-Za-z_]\w*/g, weight: 2, evidence: '@@ 系统变量' },
  ],
  postgres: [
    { re: /::\s*[A-Za-z_]/g, weight: 2, evidence: ':: 类型转换' },
    { re: /\bRETURNING\b/gi, weight: 2, evidence: 'RETURNING' },
    { re: /\$[A-Za-z_0-9]*\$/g, weight: 2, evidence: '$$ 字符串' },
    { re: /\bILIKE\b/gi, weight: 2, evidence: 'ILIKE' },
    { re: /\bSERIAL\b/gi, weight: 1, evidence: 'SERIAL' },
    { re: /\bLATERAL\b/gi, weight: 1, evidence: 'LATERAL' },
  ],
  dm8: [
    { re: /\bROWNUM\b/gi, weight: 3, evidence: 'ROWNUM' },
    { re: /\(\s*\+\s*\)/g, weight: 3, evidence: '(+) 外连接' },
    { re: /\bNVL\s*\(/gi, weight: 1, evidence: 'NVL' },
    { re: /\bDECODE\s*\(/gi, weight: 2, evidence: 'DECODE' },
    { re: /\bCONNECT\s+BY\b/gi, weight: 3, evidence: 'CONNECT BY' },
    { re: /\bDUAL\b/gi, weight: 2, evidence: 'DUAL' },
    { re: /\bMINUS\b/gi, weight: 2, evidence: 'MINUS' },
    { re: /\bVARCHAR2\b/gi, weight: 1, evidence: 'VARCHAR2' },
  ],
};

function countMatches(sql: string, re: RegExp): number {
  const matches = sql.match(re);
  return matches ? matches.length : 0;
}

export function detectDialect(sql: string): DialectGuess {
  const scored = (Object.keys(FEATURES) as ResolvedDialect[]).map((dialect) => {
    let score = 0;
    const evidence: string[] = [];
    for (const feature of FEATURES[dialect]) {
      const count = Math.min(3, countMatches(sql, feature.re));
      if (count > 0) {
        score += feature.weight * count;
        evidence.push(feature.evidence);
      }
    }
    return { dialect, score, evidence };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1]!;

  if (top.score === 0) {
    return {
      dialect: 'mysql',
      confidence: 0.3,
      evidence: ['没有明显方言特征，默认按 MySQL 解析'],
    };
  }

  const confidence = Math.max(
    0.35,
    Math.min(0.95, top.score / (top.score + second.score + 0.5)),
  );

  return {
    dialect: top.dialect,
    confidence: Number(confidence.toFixed(2)),
    evidence: top.evidence.slice(0, 3),
  };
}

export function resolveDialect(selected: Dialect, sql: string): DialectGuess {
  if (selected !== 'auto') {
    return { dialect: selected, confidence: 1, evidence: ['手动指定'] };
  }
  return detectDialect(sql);
}
