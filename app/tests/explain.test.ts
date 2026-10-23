import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM dwd_order o
JOIN dim_user u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

describe('analyzeSql', () => {
  it('总结里包含关键表与限条', () => {
    const analysis = analyzeSql(GOLDEN, 'mysql');
    expect(analysis.summary).toContain('dwd_order');
    expect(analysis.summary).toContain('dim_user');
    expect(analysis.summary).toContain('取前 100 行');
    expect(analysis.dialect).toBe('mysql');
  });

  it('WHERE 解释成大白话', () => {
    const analysis = analyzeSql(GOLDEN, 'mysql');
    const where = analysis.statements[0]!.clauses.find((clause) => clause.kind === 'where')!;
    const explanation = analysis.explanations.find((item) => item.clauseId === where.id)!;
    expect(explanation.plain).toContain('o.dt 等于 2024-01-01');
    expect(explanation.plain).toContain('u.status 等于 1');
  });

  it('SELECT 列表解释列数与别名', () => {
    const analysis = analyzeSql(GOLDEN, 'mysql');
    const select = analysis.statements[0]!.clauses.find((clause) => clause.kind === 'select')!;
    const explanation = analysis.explanations.find((item) => item.clauseId === select.id)!;
    expect(explanation.plain).toContain('最终输出 2 列');
    expect(explanation.plain).toContain('行数（cnt）');
    expect(explanation.plain).toContain('dwd_order.user_id');
  });

  it('报出 SELECT * 风险', () => {
    const analysis = analyzeSql('SELECT * FROM a', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-01')).toBe(true);
  });

  it('不会把 COUNT(*) 误判成 SELECT *', () => {
    const analysis = analyzeSql('SELECT COUNT(*) FROM t', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-01')).toBe(false);
  });

  it('报出缺少连接条件的 JOIN', () => {
    const analysis = analyzeSql('SELECT * FROM a JOIN b', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-02')).toBe(true);
  });

  it('报出 LIMIT 没有 ORDER BY', () => {
    const analysis = analyzeSql('SELECT id FROM t LIMIT 10', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-13')).toBe(true);
  });

  it('DM8 下报出 ROWNUM 与 ORDER BY 的陷阱', () => {
    const analysis = analyzeSql(
      'SELECT * FROM t WHERE ROWNUM <= 10 ORDER BY id DESC',
      'dm8',
    );
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-16')).toBe(true);
  });

  it('自动识别 DM8 特征', () => {
    const analysis = analyzeSql('SELECT * FROM dual WHERE ROWNUM <= 1');
    expect(analysis.dialect).toBe('dm8');
    expect(analysis.confidence).toBeGreaterThan(0.5);
  });

  it('任何畸形输入都不抛异常', () => {
    const inputs = ["SELECT '", '((((', '-- only comment', '\u0000\u0001', ''];
    for (const input of inputs) {
      expect(() => analyzeSql(input)).not.toThrow();
    }
  });
});
