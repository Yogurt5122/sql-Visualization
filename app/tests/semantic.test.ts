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

  it('总结会展开 CTE 的底层表', () => {
    const analysis = analyzeSql(
      `WITH base AS (
  SELECT id, amount FROM t WHERE amount > 0
)
SELECT b.id, SUM(b.amount) AS total
FROM base b
WHERE b.id > 0
GROUP BY b.id
ORDER BY total DESC
LIMIT 10`,
      'mysql',
    );
    expect(analysis.summary).toContain('CTE');
    expect(analysis.summary).toContain('base');
    expect(analysis.summary).toContain('t');
    expect(analysis.summary).toContain('取前 10 行');
    expect(analysis.metrics.tables).toBe(1);
  });

  it('CTE 血缘会追到物理表，并记录经过的 CTE', () => {
    const analysis = analyzeSql(
      `WITH base AS (
  SELECT id, amount FROM dwd_order WHERE amount > 0
)
SELECT b.id, b.amount FROM base b`,
      'mysql',
    );
    const lineage = analysis.relations[0]!.lineage;

    expect(lineage[0]?.source).toBe('dwd_order.id');
    expect(lineage[0]?.via).toEqual(['base']);
    expect(lineage[1]?.source).toBe('dwd_order.amount');
    expect(lineage[1]?.via).toEqual(['base']);
    expect(lineage[0]?.confidence).toBe('exact');
  });

  it('CTE 链会逐层递归到底层表', () => {
    const analysis = analyzeSql(
      `WITH a AS (SELECT id FROM src),
b AS (SELECT id FROM a)
SELECT id FROM b`,
      'mysql',
    );
    const lineage = analysis.relations[0]!.lineage;

    expect(lineage[0]?.source).toBe('src.id');
    expect(lineage[0]?.via).toEqual(['b', 'a']);
  });

  it('多语句会分别生成总结和关系', () => {
    const analysis = analyzeSql('SELECT id FROM a; SELECT name FROM b;', 'mysql');

    expect(analysis.statements).toHaveLength(2);
    expect(analysis.summaries).toHaveLength(2);
    expect(analysis.summaries[0]).toContain('a');
    expect(analysis.summaries[1]).toContain('b');
    expect(analysis.relations).toHaveLength(2);
    expect(analysis.metricsByStatement).toHaveLength(2);
    expect(analysis.metricsByStatement[0]?.tables).toBe(1);
    expect(analysis.metricsByStatement[1]?.tables).toBe(1);
  });

  it('QueryBlock 收集 WHERE / SELECT 子查询、深度和关联标记', () => {
    const analysis = analyzeSql(
      `SELECT o.id,
  (SELECT MAX(u.id) FROM dim_user u WHERE u.id = o.user_id) AS max_id
FROM dwd_order o
WHERE o.user_id IN (SELECT id FROM dim_user)`,
      'mysql',
    );
    const model = analysis.semantic[0]!;

    expect(model.subqueries.map((query) => query.origin)).toEqual([
      'where',
      'select',
    ]);
    expect(model.subqueries[0]?.parentClauseKind).toBe('where');
    expect(model.subqueries[1]?.parentClauseKind).toBe('select');
    expect(model.subqueries[1]?.depth).toBe(1);
    expect(model.subqueries[0]?.correlated).toBe(false);
    expect(model.subqueries[1]?.correlated).toBe(true);
  });

  it('QueryBlock 记录 JOIN 键和聚合标记', () => {
    const analysis = analyzeSql(
      'SELECT a.status, SUM(b.amount) AS total FROM a JOIN b ON a.status = b.status GROUP BY a.status',
      'mysql',
    );
    const model = analysis.semantic[0]!;

    expect(model.joinKeys[0]).toMatchObject({
      left: 'a.status',
      right: 'b.status',
      operator: '=',
    });
    expect(model.hasAggregate).toBe(true);
    expect(analysis.metrics.depth).toBe(0);
  });

  it('UNION 分支进入 QueryBlock，并生成分支总结', () => {
    const analysis = analyzeSql(
      'SELECT id FROM a UNION ALL SELECT id FROM b',
      'mysql',
    );
    const model = analysis.semantic[0]!;

    expect(model.branches).toHaveLength(1);
    expect(model.branches[0]?.origin).toBe('union');
    expect(model.branches[0]?.branchOperator).toBe('union all');
    expect(model.branches[0]?.tables).toEqual(['b']);
    expect(analysis.metrics.tables).toBe(2);
    expect(analysis.summary).toContain('2 个 UNION 分支');
    expect(analysis.summary).toContain('a');
    expect(analysis.summary).toContain('b');
  });

  it('CTE 链总结会递归到物理表并标出经过的 CTE', () => {
    const analysis = analyzeSql(
      `WITH paid AS (
  SELECT id, amount FROM dwd_order
),
stats AS (
  SELECT id, SUM(amount) AS total FROM paid GROUP BY id
)
SELECT id, total FROM stats`,
      'mysql',
    );

    expect(analysis.summary).toContain('stats ← dwd_order');
    expect(analysis.summary).toContain('经 paid');
    expect(analysis.metrics.tables).toBe(1);
  });

  it('UNION 分支血缘会并到对应输出列', () => {
    const analysis = analyzeSql(
      'SELECT id FROM a UNION ALL SELECT id FROM b',
      'mysql',
    );
    const row = analysis.relations[0]?.lineage[0];

    expect(row?.source).toContain('a.id');
    expect(row?.source).toContain('分支 1: b.id');
  });

  it('CTE 关系图补出到底层物理表的依赖边', () => {
    const analysis = analyzeSql(
      `WITH paid AS (
  SELECT id, amount FROM dwd_order
),
stats AS (
  SELECT id, SUM(amount) AS total FROM paid GROUP BY id
)
SELECT id, total FROM stats`,
      'mysql',
    );
    const relations = analysis.relations[0]!;
    const cte = relations.sources.find((source) => source.kind === 'cte');
    const dependency = relations.dependencies?.find((item) => item.from === cte?.id);
    const target = relations.sources.find((source) => source.id === dependency?.to);

    expect(cte?.name).toBe('stats');
    expect(dependency?.condition).toBe('CTE 依赖');
    expect(target?.name).toBe('dwd_order');
  });

  it('SELECT * 的预输出标为全部字段并带来源表', () => {
    const analysis = analyzeSql(
      'SELECT * FROM dwd_order o JOIN dim_user u ON u.id = o.user_id',
      'mysql',
    );
    const row = analysis.relations[0]?.lineage[0];

    expect(row?.output).toBe('*');
    expect(row?.source).toContain('dwd_order');
    expect(analysis.semantic[0]?.outputNames).toEqual(['*']);
  });
});
