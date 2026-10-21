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

describe('semantic AST', () => {
  it('MySQL 解析成功时进入语义模式', () => {
    const analysis = analyzeSql(GOLDEN, 'mysql');
    expect(analysis.mode).toBe('semantic');
    expect(analysis.parseError).toBeUndefined();
    expect(analysis.relations[0]?.sources.map((source) => source.name)).toEqual([
      'dwd_order',
      'dim_user',
    ]);
    expect(analysis.relations[0]?.joins).toHaveLength(1);
    expect(analysis.relations[0]?.lineage[0]?.source).toBe('dwd_order.user_id');
    expect(analysis.relations[0]?.lineage[1]?.source).toBe('按行计数');
  });

  it('CTE 会被标记为 cte 数据源', () => {
    const analysis = analyzeSql(
      `WITH base AS (SELECT id, amount FROM t)
SELECT base.id, SUM(base.amount) AS total
FROM base
GROUP BY base.id`,
      'mysql',
    );
    expect(analysis.mode).toBe('semantic');
    expect(analysis.relations[0]?.sources[0]?.kind).toBe('cte');
    expect(analysis.relations[0]?.lineage[1]?.transform).toBe('aggregate');
  });

  it('SQL Server 的 TOP 也能走语义解析', () => {
    const analysis = analyzeSql('SELECT TOP 10 id FROM dbo.t', 'tsql');
    expect(analysis.mode).toBe('semantic');
    expect(analysis.relations[0]?.sources.length).toBe(1);
  });

  it('语法错误回退结构模式并记录位置', () => {
    const analysis = analyzeSql('SELECT * FROM', 'mysql');
    expect(analysis.mode).toBe('structural');
    expect(analysis.parseError).toBeDefined();
  });

  it('DM8 仍走结构模式，但不产生解析错误横幅', () => {
    const analysis = analyzeSql('SELECT * FROM dm_emp WHERE ROWNUM <= 10', 'dm8');
    expect(analysis.mode).toBe('structural');
    expect(analysis.parseError).toBeUndefined();
  });
});
