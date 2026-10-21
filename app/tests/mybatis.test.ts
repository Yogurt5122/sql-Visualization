import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';
import { preprocessMyBatis } from '../src/preprocess/mybatis';

const XML = `<select id="query">
  SELECT u.id, u.name
  FROM user u
  <where>
    <if test="status != null"> AND u.status = #{status} </if>
    <if test="name != null"> AND u.name LIKE CONCAT('%', #{name}, '%') </if>
  </where>
</select>`;

describe('preprocessMyBatis', () => {
  it('识别标签并保持长度与行号不变', () => {
    const result = preprocessMyBatis(XML, 'all');
    expect(result.detected).toBe(true);
    expect(result.dynamicConditions).toBe(2);
    expect(result.tags).toContain('if');
    expect(result.tags).toContain('where');
    expect(result.sql).toHaveLength(XML.length);
    expect(result.sql.split('\n')).toHaveLength(XML.split('\n').length);
    expect(result.sql).not.toContain('<if');
    expect(result.sql).not.toContain('<where');
  });

  it('全保留变体保留动态条件内容', () => {
    const result = preprocessMyBatis(XML, 'all');
    expect(result.sql).toContain('u.status');
    expect(result.sql).toContain('u.name LIKE');
  });

  it('全去掉变体会清空动态条件', () => {
    const result = preprocessMyBatis(XML, 'none');
    expect(result.sql).not.toContain('u.status');
    expect(result.sql).not.toContain('u.name LIKE');
    expect(result.sql).toHaveLength(XML.length);
  });

  it('where 标签后多余的 AND 会被去掉', () => {
    const result = preprocessMyBatis(XML, 'all');
    expect(/WHERE\s+AND/i.test(result.sql)).toBe(false);
  });

  it('接入分析后子句里不再出现 XML 标签', () => {
    const analysis = analyzeSql(XML, 'mysql', { mybatisVariant: 'all' });
    expect(analysis.preprocess.detected).toBe(true);
    expect(analysis.mode).toBe('semantic');
    expect(analysis.statements).toHaveLength(1);
    expect(analysis.statements[0]?.text).not.toContain('<if');
    expect(analysis.statements[0]?.text).not.toContain('<select');
  });
});
