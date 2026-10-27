import { describe, expect, it } from 'vitest';
import { findKeywordAt, SYNTAX_ENTRIES } from '../src/core/syntax';

describe('关键字语法', () => {
  it('能命中 SELECT', () => {
    const sql = 'SELECT a FROM t_demo_order';
    const hit = findKeywordAt(sql, sql.indexOf('SELECT') + 2);

    expect(hit?.entry.keyword).toBe('SELECT');
    expect(hit?.entry.example).toContain('SELECT');
  });

  it('点击 BY 也能下钻到 GROUP BY', () => {
    const sql = 'SELECT a FROM t_demo_order GROUP BY a';
    const hit = findKeywordAt(sql, sql.indexOf('BY') + 1);

    expect(hit?.entry.keyword).toBe('GROUP BY');
  });

  it('普通字段和字符串不会误触发', () => {
    const sql = "SELECT a FROM t_demo_order WHERE a = 'SELECT'";
    expect(findKeywordAt(sql, sql.indexOf('t_demo_order') + 2)).toBeNull();
    expect(findKeywordAt(sql, sql.indexOf("'SELECT'") + 3)).toBeNull();
  });

  it('词典中的关联关键字都有定义', () => {
    for (const entry of Object.values(SYNTAX_ENTRIES)) {
      for (const related of entry.related ?? []) {
        expect(SYNTAX_ENTRIES[related], `${entry.keyword} -> ${related}`).toBeDefined();
      }
    }
  });
});
