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
FROM dwd_order o
JOIN dim_user u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

describe('buildRelations', () => {
  it('识别表、别名与连接', () => {
    const { relations } = analyze(GOLDEN);
    expect(relations.sources.map((source) => source.name)).toEqual(['dwd_order', 'dim_user']);
    expect(relations.sources[0]?.alias).toBe('o');
    expect(relations.joins).toHaveLength(1);
    expect(relations.joins[0]?.type).toBe('inner');
  });

  it('输出列能追到来源字段', () => {
    const { relations } = analyze(GOLDEN);
    expect(relations.lineage).toHaveLength(2);
    expect(relations.lineage[0]?.source).toBe('dwd_order.user_id');
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
FROM dm_emp e, dm_dept d
WHERE e.dept_id(+) = d.dept_id`);
    expect(relations.joins).toHaveLength(1);
    expect(relations.joins[0]?.type).toBe('left');
    const from = relations.sources.find((source) => source.id === relations.joins[0]?.from);
    const to = relations.sources.find((source) => source.id === relations.joins[0]?.to);
    expect(from?.name).toBe('dm_dept');
    expect(to?.name).toBe('dm_emp');
  });

  it('CTE 会标记为 cte 数据源', () => {
    const { relations, metrics } = analyze(`WITH base AS (
  SELECT id FROM t
)
SELECT * FROM base`);
    expect(relations.sources).toHaveLength(1);
    expect(relations.sources[0]?.kind).toBe('cte');
    expect(relations.lineage[0]?.source).toBe('全部字段');
    expect(metrics.tables).toBe(0);
  });

  it('不会把 a + b 里的 b 误认成别名', () => {
    const { relations } = analyze('SELECT a + b FROM t');
    expect(relations.lineage[0]?.output).toBe('a + b');
  });
});
