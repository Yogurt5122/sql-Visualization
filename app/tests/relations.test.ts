import { describe, expect, it } from 'vitest';
import { buildMetrics, buildRelations } from '../src/core/relations';
import { scan } from '../src/core/scanner';
import { splitStatements } from '../src/core/splitter';

function analyze(sql: string) {
  const statement = splitStatements(sql, scan(sql).tokens)[0]!;
  const relations = buildRelations(statement);
  return { statement, relations, metrics: buildMetrics(statement, relations) };
}

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM t_demo_order o
JOIN t_demo_user_dim u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

describe('buildRelations', () => {
  it('识别表、别名与连接', () => {
    const { relations } = analyze(GOLDEN);
    expect(relations.sources.map((source) => source.name)).toEqual(['t_demo_order', 't_demo_user_dim']);
    expect(relations.sources[0]?.alias).toBe('o');
    expect(relations.joins).toHaveLength(1);
    expect(relations.joins[0]?.type).toBe('inner');
  });

  it('输出列能追到来源字段', () => {
    const { relations } = analyze(GOLDEN);
    expect(relations.lineage).toHaveLength(2);
    expect(relations.lineage[0]?.source).toBe('t_demo_order.user_id');
    expect(relations.lineage[0]?.transform).toBe('direct');
    expect(relations.lineage[1]?.source).toBe('按行计数');
    expect(relations.lineage[1]?.transform).toBe('aggregate');
  });

  it('指标卡数据与关系一致', () => {
    const { metrics } = analyze(GOLDEN);
    expect(metrics).toEqual({
      tables: 2,
      joins: 1,
      outputs: 2,
      depth: 0,
      complexity: 8,
    });
  });

  it('DM8 的 (+) 会生成左连接边', () => {
    const { relations } = analyze(`SELECT e.emp_name
FROM t_demo_emp e, t_demo_dept d
WHERE e.dept_id(+) = d.dept_id`);
    expect(relations.joins).toHaveLength(1);
    expect(relations.joins[0]?.type).toBe('left');
    const from = relations.sources.find((source) => source.id === relations.joins[0]?.from);
    const to = relations.sources.find((source) => source.id === relations.joins[0]?.to);
    expect(from?.name).toBe('t_demo_dept');
    expect(to?.name).toBe('t_demo_emp');
  });

  it('DM8 的 (+) 在右侧时保留左侧表', () => {
    const { relations } = analyze(`SELECT e.emp_name
FROM t_demo_emp e, t_demo_dept d
WHERE e.dept_id = d.dept_id(+)`);
    expect(relations.joins).toHaveLength(1);
    expect(relations.joins[0]?.type).toBe('left');
    const from = relations.sources.find((source) => source.id === relations.joins[0]?.from);
    const to = relations.sources.find((source) => source.id === relations.joins[0]?.to);
    expect(from?.name).toBe('t_demo_emp');
    expect(to?.name).toBe('t_demo_dept');
  });

  it('DM8 多个 (+) 会生成多条左连接边', () => {
    const { relations } = analyze(`SELECT e.emp_name
FROM t_demo_emp e, t_demo_dept d, t_demo_org o
WHERE e.dept_id = d.dept_id(+)
  AND e.org_id = o.id(+)`);
    expect(relations.joins).toHaveLength(2);
    expect(relations.joins.every((join) => join.type === 'left')).toBe(true);
  });

  it('DM8 普通 JOIN 与 (+) 混用时不丢边', () => {
    const { relations } = analyze(`SELECT e.emp_name
FROM t_demo_emp e
JOIN t_demo_dept d ON d.id = e.dept_id
, t_demo_org o
WHERE e.org_id = o.id(+)`);
    expect(relations.joins).toHaveLength(2);
    expect(relations.joins.map((join) => join.type).sort()).toEqual([
      'inner',
      'left',
    ]);
  });

  it('CTE 会标记为 cte 数据源', () => {
    const { relations, metrics } = analyze(`WITH base AS (
  SELECT id FROM t
)
SELECT * FROM base`);
    expect(relations.sources).toHaveLength(1);
    expect(relations.sources[0]?.kind).toBe('cte');
    expect(relations.lineage[0]?.source).toBe('base.*');
    expect(metrics.tables).toBe(0);
  });

  it('不会把 a + b 里的 b 误认成别名', () => {
    const { relations } = analyze('SELECT a + b FROM t');
    expect(relations.lineage[0]?.output).toBe('a + b');
  });
});
