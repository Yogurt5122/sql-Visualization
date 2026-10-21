import { describe, expect, it } from 'vitest';
import { buildFlow } from '../src/core/flow';
import { scan } from '../src/core/scanner';
import { splitStatements } from '../src/core/splitter';

function flowOf(sql: string) {
  const statements = splitStatements(sql, scan(sql).tokens);
  return buildFlow(statements[0]!);
}

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM dwd_order o
JOIN dim_user u ON o.user_id = u.id
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
});
