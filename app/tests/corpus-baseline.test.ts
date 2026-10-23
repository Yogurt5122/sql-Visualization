import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';
import { CORPUS } from './corpus/manifest';

// 人工基线：这些 high 是确认过的真问题，不是误报。
// 新增 high 必须在这里显式加一条，避免规则回归时悄悄多报。
const HIGH_BASELINE: Record<string, string[]> = {
  'mysql_correlated_select.sql': ['RSK-12'],
  'mysql_status_join.sql': ['RSK-14'],
  'mysql_join_missing.sql': ['RSK-02'],
  'mysql_not_in.sql': ['RSK-11'],
  'dm8_rownum.sql': ['RSK-16', 'RSK-17'],
  'dm8_both_plus.sql': ['RSK-17'],
  'dm8_nullable_filtered.sql': ['RSK-17'],
};

describe('corpus high baseline', () => {
  it('所有语料的 high 集合与人工基线一致', () => {
    const mismatches: string[] = [];

    for (const item of CORPUS) {
      const sql = readFileSync(
        new URL(`./corpus/${item.file}`, import.meta.url),
        'utf8',
      );
      const analysis = analyzeSql(sql, item.dialect);
      const actual = [
        ...new Set(
          analysis.issues
            .filter((issue) => issue.severity === 'high')
            .map((issue) => issue.ruleId),
        ),
      ].sort();
      const expected = [...(HIGH_BASELINE[item.file] ?? [])].sort();

      if (actual.join(',') !== expected.join(',')) {
        mismatches.push(
          `${item.file}: 期望 [${expected.join(', ')}]，实际 [${actual.join(', ')}]`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('17 条规则都有真实语料覆盖', () => {
    const covered = new Set(CORPUS.flatMap((item) => item.expectRules ?? []));
    const expected = Array.from({ length: 17 }, (_, index) =>
      `RSK-${String(index + 1).padStart(2, '0')}`,
    );

    expect(expected.filter((id) => !covered.has(id))).toEqual([]);
  });
});
