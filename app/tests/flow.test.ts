import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';
import { buildFlow } from '../src/core/flow';
import { scan } from '../src/core/scanner';
import { splitStatements } from '../src/core/splitter';

function flowOf(sql: string) {
  const statements = splitStatements(sql, scan(sql).tokens);
  return buildFlow(statements[0]!);
}

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM t_demo_order o
JOIN t_demo_user_dim u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

describe('buildFlow', () => {
  it('按逻辑求值顺序排列，而不是书写顺序', () => {
    const steps = flowOf(GOLDEN);
    expect(steps.map((step) => step.label)).toEqual([
      'FROM / JOIN',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'SELECT',
      'ORDER BY',
      'LIMIT',
    ]);
  });

  it('给出表数、连接数与精确行号', () => {
    const source = flowOf(GOLDEN)[0]!;
    expect(source.detail).toBe('2 张表 · 1 个连接');
    expect(source.startLine).toBe(2);
    expect(source.endLine).toBe(3);
  });

  it('不存在 GROUP BY / ORDER BY 时不生成空阶段', () => {
    const labels = flowOf('SELECT id FROM t WHERE id > 1').map((step) => step.label);
    expect(labels).toEqual(['FROM / JOIN', 'WHERE', 'SELECT']);
  });

  it('识别 DISTINCT 与窗口函数', () => {
    const labels = flowOf(
      'SELECT DISTINCT user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY dt DESC) AS rn FROM t',
    ).map((step) => step.label);
    expect(labels).toEqual(['FROM / JOIN', 'WINDOW', 'SELECT', 'DISTINCT']);
  });

  it('LIMIT 阶段带上具体行数', () => {
    const limit = flowOf('SELECT id FROM t LIMIT 20')[2]!;
    expect(limit.label).toBe('LIMIT');
    expect(limit.detail).toBe('只取前 20 行');
  });

  it('每个阶段都能映射回子句 id', () => {
    const steps = flowOf(GOLDEN);
    for (const step of steps) {
      expect(step.clauseIds.length).toBeGreaterThan(0);
    }
  });

  it('带关系时说明具体表和输出字段，而不是只说取数/计算', () => {
    const analysis = analyzeSql(
      'SELECT o.user_id AS uid, o.amount FROM t_demo_order o WHERE o.status = 1',
      'mysql',
    );
    const steps = buildFlow(analysis.statements[0]!, analysis.relations[0]);
    const source = steps.find((step) => step.kind === 'source')!;
    const select = steps.find((step) => step.kind === 'select')!;

    expect(source.detail).toContain('t_demo_order');
    expect(source.title).toBe('读取表');
    expect(select.title).toBe('输出字段');
    expect(select.detail).toContain('uid');
    expect(select.detail).toContain('amount');
  });

  it('UNION ALL 会生成主查询、分支和合并阶段', () => {
    const steps = flowOf(
      'SELECT id FROM t_demo_a UNION ALL SELECT id FROM t_demo_b',
    );
    const union = steps.find((step) => step.kind === 'union')!;

    expect(steps.map((step) => step.label)).toEqual([
      'FROM / JOIN',
      'SELECT',
      'FROM / JOIN',
      'SELECT',
      'UNION ALL',
    ]);
    expect(steps.slice(0, 2).every((step) => step.branch === undefined)).toBe(true);
    expect(steps.slice(2, 4).every((step) => step.branch === 1)).toBe(true);
    expect(union.branch).toBeUndefined();
    expect(union.title).toBe('合并结果');
    expect(union.detail).toBe('合并 2 个分支，保留重复行');
  });

  it('连续 UNION 会为每个分支生成流程', () => {
    const steps = flowOf(
      'SELECT id FROM t_demo_a UNION ALL SELECT id FROM t_demo_b UNION SELECT id FROM t_demo_c',
    );
    const union = steps.find((step) => step.kind === 'union')!;

    expect(steps.filter((step) => step.branch === 1)).toHaveLength(2);
    expect(steps.filter((step) => step.branch === 2)).toHaveLength(2);
    expect(union.detail).toBe('合并 3 个分支，保留重复行');
  });

  it('JOIN / WHERE / HAVING 流程卡写到具体键和条件', () => {
    const analysis = analyzeSql(GOLDEN, 'mysql');
    const steps = buildFlow(analysis.statements[0]!, analysis.relations[0]);
    const source = steps.find((step) => step.kind === 'source')!;
    const where = steps.find((step) => step.kind === 'where')!;
    const having = steps.find((step) => step.kind === 'having')!;

    expect(source.detail).toContain('o.user_id = u.id');
    expect(where.detail).toContain("o.dt = '2024-01-01'");
    expect(having.detail).toContain('COUNT(*) > 3');
  });
});
