import { describe, expect, it } from 'vitest';
import { parseDdlSchema, resolveSourceTypes } from '../src/core/ddl';
import { analyzeSql } from '../src/core/explain';

describe('DDL schema', () => {
  it('解析表名、字段名和类型', () => {
    const schema = parseDdlSchema(`
      CREATE TABLE t_demo_order (
        order_id BIGINT NOT NULL,
        amount DECIMAL(18, 2),
        dt DATE,
        PRIMARY KEY (order_id)
      );
    `);

    expect(schema.get('t_demo_order')?.get('order_id')).toBe('BIGINT');
    expect(schema.get('t_demo_order')?.get('amount')).toBe('DECIMAL(18, 2)');
    expect(schema.get('t_demo_order')?.get('dt')).toBe('DATE');
  });

  it('从来源表字段解析类型', () => {
    const schema = parseDdlSchema(
      'CREATE TABLE t_demo_order (order_id BIGINT, amount DECIMAL(10,2))',
    );
    expect(resolveSourceTypes('t_demo_order.amount', schema)).toBe('DECIMAL(10,2)');
    expect(resolveSourceTypes('按行计数', schema)).toBe('BIGINT');
    expect(resolveSourceTypes('常量', schema)).toBeUndefined();
  });

  it('分析带 DDL 的查询时给预输出类型', () => {
    const analysis = analyzeSql(
      `CREATE TABLE t_demo_order (
        order_id BIGINT,
        amount DECIMAL(18,2)
      );
      SELECT order_id, amount FROM t_demo_order;`,
      'mysql',
    );
    const rows = analysis.relations[1]?.lineage ?? [];

    expect(rows[0]?.type).toBe('BIGINT');
    expect(rows[1]?.type).toBe('DECIMAL(18,2)');
  });

  it('DDL 下 SELECT * 展开为具体列和类型', () => {
    const analysis = analyzeSql(
      `CREATE TABLE t_demo_order (
        order_id BIGINT,
        amount DECIMAL(18,2)
      );
      SELECT * FROM t_demo_order;`,
      'mysql',
    );
    const rows = analysis.relations[1]?.lineage ?? [];

    expect(rows.map((row) => row.output)).toEqual(['order_id', 'amount']);
    expect(rows[0]?.source).toBe('t_demo_order.order_id');
    expect(rows[0]?.type).toBe('BIGINT');
    expect(rows[1]?.type).toBe('DECIMAL(18,2)');
  });
});
