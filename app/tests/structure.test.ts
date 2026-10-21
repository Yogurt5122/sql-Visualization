import { describe, expect, it } from 'vitest';
import { buildStructure, filterStructure, findActiveNode } from '../src/core/structure';
import type { StructureNode } from '../src/core/structure';
import { scan } from '../src/core/scanner';
import { splitStatements } from '../src/core/splitter';

const GOLDEN = `SELECT o.user_id, COUNT(*) AS cnt
FROM dwd_order o
JOIN dim_user u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

function structureOf(sql: string): StructureNode {
  const statements = splitStatements(sql, scan(sql).tokens);
  return buildStructure(statements[0]!);
}

function flatten(nodes: StructureNode[]): StructureNode[] {
  const result: StructureNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flatten(node.children));
  }
  return result;
}

describe('buildStructure', () => {
  it('语句 → 主查询 → 子句的层级正确', () => {
    const root = structureOf(GOLDEN);
    expect(root.kind).toBe('statement');
    expect(root.children).toHaveLength(1);

    const query = root.children[0]!;
    expect(query.label).toBe('主查询');
    expect(query.children.map((child) => child.label)).toEqual([
      'SELECT',
      'FROM',
      'JOIN',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'ORDER BY',
      'LIMIT',
    ]);
  });

  it('识别 FROM 里的子查询并给出行号', () => {
    const root = structureOf(`SELECT *
FROM (
  SELECT id FROM t
) s
WHERE s.id > 1`);

    const from = root.children[0]!.children.find((child) => child.label === 'FROM')!;
    expect(from.children).toHaveLength(1);
    expect(from.children[0]!.label).toBe('#1');
    expect(from.children[0]!.startLine).toBe(2);
    expect(from.children[0]!.endLine).toBe(4);
  });

  it('识别 CTE 名称并挂在 WITH 下', () => {
    const root = structureOf(`WITH base AS (
  SELECT id FROM t
)
SELECT * FROM base`);

    expect(root.children.map((child) => child.label)).toEqual(['WITH', '主查询']);
    const withNode = root.children[0]!;
    expect(withNode.children).toHaveLength(1);
    expect(withNode.children[0]!.label).toBe('base');
    expect(withNode.children[0]!.startLine).toBe(1);
    expect(withNode.children[0]!.endLine).toBe(3);
  });

  it('当前行能定位到最深的节点', () => {
    const root = structureOf(GOLDEN);
    expect(findActiveNode([root], 4)?.label).toBe('WHERE');
    expect(findActiveNode([root], 2)?.label).toBe('FROM');
    expect(findActiveNode([root], 99)).toBeUndefined();
  });

  it('搜索会把命中的祖先一起保留', () => {
    const root = structureOf(GOLDEN);
    const filtered = filterStructure([root], 'dim_user', false);
    const labels = flatten(filtered).map((node) => node.label);
    expect(labels).toContain('JOIN');
    expect(labels).toContain('主查询');
    expect(labels).not.toContain('LIMIT');
  });

  it('只看含表节点会过滤掉纯计算子句', () => {
    const root = structureOf(GOLDEN);
    const filtered = filterStructure([root], '', true);
    const labels = flatten(filtered).map((node) => node.label);
    expect(labels).toContain('FROM');
    expect(labels).toContain('JOIN');
    expect(labels).not.toContain('LIMIT');
  });
});
