import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';
import { buildStructure } from '../src/core/structure';

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM t_demo_order o
JOIN t_demo_user_dim u ON o.user_id = u.id
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
      't_demo_order',
      't_demo_user_dim',
    ]);
    expect(analysis.relations[0]?.joins).toHaveLength(1);
    expect(analysis.relations[0]?.lineage[0]?.source).toBe('t_demo_order.user_id');
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

  it('DM8 通过兼容语法走语义模式，且不产生解析错误横幅', () => {
    const analysis = analyzeSql('SELECT * FROM t_demo_emp WHERE ROWNUM <= 10', 'dm8');
    expect(analysis.mode).toBe('semantic');
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
  SELECT id, amount FROM t_demo_order WHERE amount > 0
)
SELECT b.id, b.amount FROM base b`,
      'mysql',
    );
    const lineage = analysis.relations[0]!.lineage;

    expect(lineage[0]?.source).toBe('t_demo_order.id');
    expect(lineage[0]?.via).toEqual(['base']);
    expect(lineage[1]?.source).toBe('t_demo_order.amount');
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
  (SELECT MAX(u.id) FROM t_demo_user_dim u WHERE u.id = o.user_id) AS max_id
FROM t_demo_order o
WHERE o.user_id IN (SELECT id FROM t_demo_user_dim)`,
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
  SELECT id, amount FROM t_demo_order
),
stats AS (
  SELECT id, SUM(amount) AS total FROM paid GROUP BY id
)
SELECT id, total FROM stats`,
      'mysql',
    );

    expect(analysis.summary).toContain('stats ← t_demo_order');
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
  SELECT id, amount FROM t_demo_order
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
    expect(target?.name).toBe('t_demo_order');
  });

  it('SELECT * 的预输出标为全部字段并带来源表', () => {
    const analysis = analyzeSql(
      'SELECT * FROM t_demo_order o JOIN t_demo_user_dim u ON u.id = o.user_id',
      'mysql',
    );
    const row = analysis.relations[0]?.lineage[0];

    expect(row?.output).toBe('*');
    expect(row?.source).toContain('t_demo_order');
    expect(analysis.semantic[0]?.outputNames).toEqual(['*']);
  });

  it('子查询派生列不冒充物理表字段', () => {
    const analysis = analyzeSql(
      `SELECT T.demo_label AS "demo_label", T.demo_count AS "demo_count"
FROM (
  SELECT 't_demo_asset' AS demo_label, COUNT(*) AS demo_count
  FROM t_demo_asset
) T`,
      'mysql',
    );
    const rows = analysis.relations[0]!.lineage;

    expect(rows[0]?.source).toBe('常量');
    expect(rows[1]?.source).toBe('按行计数');
    expect(rows[1]?.source).not.toContain('t_demo_asset.demo_count');
    expect(rows[1]?.transform).toBe('aggregate');
    expect(rows[1]?.via).toContain('T');
  });

  it('CTE 派生列也追到按行计数，而不是 CTE.CNT', () => {
    const analysis = analyzeSql(
      'WITH x AS (SELECT COUNT(*) AS CNT FROM t) SELECT x.CNT AS cnt FROM x',
      'mysql',
    );
    const row = analysis.relations[0]?.lineage[0];

    expect(row?.source).toBe('按行计数');
    expect(row?.source).not.toContain('x.CNT');
    expect(row?.transform).toBe('aggregate');
    expect(row?.via).toContain('x');
  });

  it('SELECT * 穿过已知 CTE 输出列', () => {
    const analysis = analyzeSql(
      'WITH x AS (SELECT id, name FROM t) SELECT * FROM x',
      'mysql',
    );
    const rows = analysis.relations[0]!.lineage;

    expect(rows.map((row) => row.output)).toEqual(['id', 'name']);
    expect(rows[0]?.source).toBe('t.id');
    expect(rows[0]?.via).toContain('x');
    expect(rows[1]?.source).toBe('t.name');
  });

  it('SELECT * 穿过已知派生表输出列', () => {
    const analysis = analyzeSql(
      'SELECT * FROM (SELECT id, amount FROM t_demo_order) s',
      'mysql',
    );
    const rows = analysis.relations[0]!.lineage;

    expect(rows.map((row) => row.output)).toEqual(['id', 'amount']);
    expect(rows[0]?.source).toBe('t_demo_order.id');
    expect(rows[0]?.via).toContain('s');
  });

  it('SELECT * 对未知物理表仍保持全部字段', () => {
    const analysis = analyzeSql('SELECT * FROM t_demo_order', 'mysql');
    const row = analysis.relations[0]?.lineage[0];

    expect(row?.output).toBe('*');
    expect(row?.source).toBe('t_demo_order.*');
    expect(row?.confidence).toBe('unknown');
  });

  it('嵌套派生表：无别名直接列、内部 JOIN、WHERE 分块', () => {
    const analysis = analyzeSql(
      `SELECT *
       FROM (
         SELECT
           t1.value_1,
           t1.value_2,
           t2.value_3 AS value_3
         FROM t_demo_1 t1
         LEFT JOIN t_demo_2 t2 ON t1.value_1 = t2.value_1
         LEFT JOIN t_demo_3 t3 ON t1.value_2 = t3.value_1
         WHERE t1.value_1 IN (
           SELECT value_1 FROM t_demo_4 WHERE value_2 = 'x'
         ) AND t1.value_3 = '0'
       ) t_demo_all
       WHERE 1 = 1 /*sqlwhere*/`,
      'mysql',
    );
    const relation = analysis.relations[0]!;

    expect(relation.sources.filter((source) => source.kind === 'table')).toHaveLength(3);
    expect(relation.joins).toHaveLength(2);
    expect(relation.lineage.map((row) => row.output)).toEqual([
      'value_1',
      'value_2',
      'value_3',
    ]);
    expect(relation.lineage[0]?.source).toBe('t_demo_1.value_1');
    expect(relation.lineage[0]?.via).toContain('t_demo_all');
    expect(relation.lineage[2]?.source).toBe('t_demo_2.value_3');
    expect(relation.filters?.some((filter) => filter.placeholder)).toBe(true);
    expect(relation.filters?.filter((filter) => !filter.placeholder)).toHaveLength(1);
    expect(analysis.metrics.tables).toBe(3);
    expect(analysis.summary).toContain('内部 3 张表、2 个连接');
    const where = analysis.statements[0]!.clauses.find((clause) => clause.kind === 'where')!;
    const explanation = analysis.explanations.find((item) => item.clauseId === where.id)!;
    expect(explanation.plain).toContain('占位条件');
    expect(explanation.plain).toContain('内层查询还有 1 个过滤条件');
  });

  it('宽派生表的直接列与多个 JOIN 不丢来源', () => {
    const baseFields = Array.from(
      { length: 141 },
      (_, index) => `t1.value_${index + 1}`,
    );
    const extraFields = [
      't2.value_142 AS value_145',
      't3.value_142 AS value_146',
      't7.value_142 AS value_147',
      't4.value_1 AS value_148',
      't5.value_1 AS value_149',
      't6.value_1 AS value_150',
      't8.value_142 AS value_151',
    ];
    const analysis = analyzeSql(
      `SELECT *
       FROM (
         SELECT
           ${[...baseFields, ...extraFields].join(',\n')}
         FROM t_demo_1 t1
         LEFT JOIN t_demo_2 t2 ON t1.value_10 = t2.value_1
         LEFT JOIN t_demo_3 t3 ON t1.value_138 = t3.value_1
         LEFT JOIN t_demo_4 t4 ON t4.value_143 = t1.value_1
         LEFT JOIN t_demo_5 t5 ON t5.value_143 = t1.value_1
         LEFT JOIN t_demo_6 t6 ON t6.value_143 = t1.value_1
         LEFT JOIN t_demo_2 t7 ON t1.value_8 = t7.value_1
         LEFT JOIN t_demo_7 t8 ON t8.value_1 = t1.value_12
         WHERE t1.value_12 IN (
           SELECT value_1 FROM t_demo_7 WHERE value_144 = '123'
         ) AND t1.value_112 = '0'
       ) t_demo_all
       WHERE 1 = 1 /*sqlwhere*/`,
      'mysql',
    );
    const relation = analysis.relations[0]!;

    expect(relation.lineage).toHaveLength(148);
    expect(relation.lineage[0]?.source).toBe('t_demo_1.value_1');
    expect(relation.lineage[140]?.source).toBe('t_demo_1.value_141');
    expect(relation.lineage[141]?.source).toBe('t_demo_2.value_142');
    const tableSources = relation.sources.filter((source) => source.kind === 'table');
    expect(tableSources).toHaveLength(8);
    expect(new Set(tableSources.map((source) => source.name))).toHaveLength(7);
    expect(relation.joins).toHaveLength(7);
    expect(analysis.metrics.tables).toBe(7);
    expect(analysis.metrics.joins).toBe(7);
    expect(relation.filters?.some((filter) => filter.placeholder)).toBe(true);
  });

  it('CTE 摘要会说明每个 CTE 做了什么', () => {
    const analysis = analyzeSql(
      `WITH base AS (
         SELECT user_id, amount
         FROM t_demo_order
         WHERE status = 'PAID'
       ),
       agg AS (
         SELECT user_id, SUM(amount) AS total
         FROM base
         GROUP BY user_id
       ),
       ranked AS (
         SELECT user_id, total,
                LAG(total) OVER (PARTITION BY user_id ORDER BY total) AS prev_total
         FROM agg
       )
       SELECT * FROM ranked`,
      'mysql',
    );

    const ctes = analysis.semantic[0]!.ctes;
    expect(ctes.map((cte) => cte.name)).toEqual(['base', 'agg', 'ranked']);
    expect(ctes[0]!.description).toContain('从 t_demo_order 取数');
    expect(ctes[0]!.description).toContain('过滤 1 个条件');
    expect(ctes[1]!.description).toContain('分组汇总 SUM');
    expect(ctes[2]!.description).toContain('LAG 窗口计算');
    expect(analysis.summary).toContain('base ← t_demo_order');
    expect(analysis.summary).toContain('分组汇总 SUM');
    expect(analysis.summary).toContain('LAG 窗口计算');
  });

  it('DM8 不会直接跳过语义解析，CTE 仍有说明', () => {
    const analysis = analyzeSql(
      `WITH param AS (
         SELECT CASE
           WHEN LENGTH(REPLACE(TRIM('2026-10'), '-', '')) >= 6
             THEN SUBSTR(REPLACE(TRIM('2026-10'), '-', ''), 1, 6)
           ELSE TO_CHAR(SYSDATE, 'YYYYMM')
         END AS value_4
         FROM DUAL
       ),
       agg AS (
         SELECT t1.value_1, NVL(SUM(t1.value_3), 0) AS value_5
         FROM t_demo_1 t1
         WHERE t1.value_2 <= (SELECT value_4 FROM param)
         GROUP BY t1.value_1
       )
       SELECT a.value_1, LAG(a.value_5) OVER (PARTITION BY a.value_1 ORDER BY a.value_5) AS value_6
       FROM agg a`,
      'dm8',
    );

    expect(analysis.mode).toBe('semantic');
    expect(analysis.semantic[0]!.ctes).toHaveLength(2);
    expect(analysis.semantic[0]!.ctes[0]!.description).toContain('无表输入');
    expect(analysis.semantic[0]!.ctes[1]!.description).toContain('分组汇总');
  });

  it('子查询也有 purpose，并进入结构树 detail', () => {
    const analysis = analyzeSql(
      `SELECT *
       FROM t_demo_order o
       WHERE EXISTS (
         SELECT 1
         FROM t_demo_refund r
         WHERE r.order_id = o.order_id
           AND r.status = 'DONE'
       )`,
      'mysql',
    );
    const subquery = analysis.semantic[0]!.subqueries[0]!;
    expect(subquery.description).toContain('从 t_demo_refund');
    expect(subquery.description).toContain('过滤 2 个条件');

    const tree = buildStructure(analysis.statements[0]!, analysis.semantic[0]!);
    const findSubquery = (nodes: typeof tree.children): typeof tree | undefined => {
      for (const node of nodes) {
        if (node.kind === 'subquery') return node as typeof tree;
        const found = findSubquery(node.children);
        if (found) return found;
      }
      return undefined;
    };
    const node = findSubquery(tree.children);
    expect(node?.detail).toContain('从 t_demo_refund');
  });
});
