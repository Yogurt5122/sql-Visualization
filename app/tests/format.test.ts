import { describe, expect, it } from 'vitest';
import { containsMybatisTags, formatSql } from '../src/core/format';

describe('formatSql', () => {
  it('识别 MyBatis 标签，普通 SQL 不误判', () => {
    expect(containsMybatisTags('<select id="q">SELECT 1</select>')).toBe(true);
    expect(containsMybatisTags('SELECT id FROM t WHERE id = 1')).toBe(false);
  });
  it('格式化 MySQL 并保留注释', () => {
    const input = `-- 订单明细
select o.id,o.name from dwd_order o join dim_user u on u.id=o.user_id where o.dt='2024-12-01' and u.status=1 order by o.id limit 10`;
    const output = formatSql(input, 'mysql');

    expect(output).toContain('-- 订单明细');
    expect(output).toContain('SELECT');
    expect(output).toMatch(/\n\s*FROM/);
    expect(output).toMatch(/\n\s*JOIN/);
    expect(output).toMatch(/\n\s*WHERE/);
    expect(output).toMatch(/\n\s*ORDER BY/);
    expect(output).not.toContain('select ');
  });

  it('幂等：格式化两次结果一致', () => {
    const input = 'select a.id,b.name from a join b on b.id=a.id where a.status=1';
    const once = formatSql(input, 'mysql');
    const twice = formatSql(once, 'mysql');
    expect(twice).toBe(once);
  });

  it('保留 PostgreSQL 的 :: 类型转换', () => {
    const output = formatSql(
      'select sum(amount)::numeric(18,2) as total from dwd_order',
      'postgres',
    );
    expect(output).toContain('::numeric');
  });

  it('保留 DM8 的 (+) 外连接', () => {
    const output = formatSql(
      'select a.id from dm_a a, dm_b b where a.id = b.id(+)',
      'dm8',
    );
    expect(output).toContain('(+)');
  });

  it('空 SQL 原样返回，畸形 SQL 不抛错', () => {
    expect(formatSql('   ', 'mysql')).toBe('   ');
    expect(() => formatSql('SELECT FROM', 'mysql')).not.toThrow();
  });
});
