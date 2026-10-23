import { describe, expect, it } from 'vitest';
import { scan } from '../src/core/scanner';
import { splitStatements } from '../src/core/splitter';

function split(sql: string) {
  return splitStatements(sql, scan(sql).tokens);
}

describe('splitStatements', () => {
  it('只在顶层分号处切分语句', () => {
    const statements = split("SELECT 'a;b' AS x; SELECT 2");
    expect(statements).toHaveLength(2);
    expect(statements[1]?.text).toBe('SELECT 2');
  });

  it('识别主要子句', () => {
    const statements = split(
      'SELECT a FROM t WHERE x = 1 GROUP BY a HAVING COUNT(*) > 1 ORDER BY a DESC LIMIT 10',
    );
    expect(statements[0]?.clauses.map((clause) => clause.kind)).toEqual([
      'select',
      'from',
      'where',
      'groupBy',
      'having',
      'orderBy',
      'limit',
    ]);
  });

  it('子查询内部不切子句', () => {
    const statements = split('SELECT * FROM (SELECT id FROM t) s WHERE s.id > 1');
    expect(statements[0]?.clauses.map((clause) => clause.kind)).toEqual([
      'select',
      'from',
      'where',
    ]);
    expect(statements[0]?.clauses.find((clause) => clause.kind === 'from')?.text).toContain(
      'SELECT id FROM t',
    );
  });

  it('ON 合并进 JOIN', () => {
    const statements = split('SELECT * FROM a JOIN b ON a.id = b.id WHERE a.x = 1');
    expect(statements[0]?.clauses.map((clause) => clause.kind)).toEqual([
      'select',
      'from',
      'join',
      'where',
    ]);
    expect(statements[0]?.clauses.find((clause) => clause.kind === 'join')?.text).toContain(
      'ON a.id = b.id',
    );
  });

  it('保留 JOIN 的类型前缀', () => {
    const statements = split('SELECT * FROM a LEFT OUTER JOIN b ON a.id = b.id');
    const join = statements[0]?.clauses.find((clause) => clause.kind === 'join');
    expect(join?.text.trim().startsWith('LEFT OUTER JOIN')).toBe(true);
  });

  it('DELETE FROM 合并到 DELETE', () => {
    const statements = split('DELETE FROM t WHERE id = 1');
    expect(statements[0]?.kind).toBe('delete');
    expect(statements[0]?.clauses.map((clause) => clause.kind)).toEqual(['delete', 'where']);
  });

  it('行号范围准确', () => {
    const statements = split('SELECT 1\nFROM t\nWHERE x = 1');
    const where = statements[0]?.clauses.find((clause) => clause.kind === 'where');
    expect(where?.span.startLine).toBe(3);
    expect(where?.span.endLine).toBe(3);
  });

  it('没有关键字时也不会丢失内容', () => {
    const statements = split('(((( 123');
    expect(statements).toHaveLength(1);
    expect(statements[0]?.clauses).toHaveLength(1);
    expect(statements[0]?.clauses[0]?.kind).toBe('other');
  });

  it('UNION ALL 保持一条语句，同时切出 UNION 子句', () => {
    const statements = split(
      'SELECT id FROM a UNION ALL SELECT id FROM b;',
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.kind).toBe('select');
    expect(statements[0]?.clauses.map((clause) => clause.kind)).toEqual([
      'select',
      'from',
      'union',
      'select',
      'from',
    ]);
    expect(statements[0]?.clauses[2]?.text).toContain('UNION ALL');
  });
});
