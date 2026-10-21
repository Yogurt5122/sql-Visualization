import { Parser } from 'node-sql-parser';
import type {
  JoinType,
  LineageRow,
  LineageTransform,
  RelationJoin,
  RelationSource,
  Relations,
  ResolvedDialect,
} from '../core/types';

const parser = new Parser();

const DATABASE: Partial<Record<ResolvedDialect, string>> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  tsql: 'TransactSQL',
};

export interface SemanticParse {
  ok: boolean;
  ast?: unknown;
  error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export function parseSemantic(sql: string, dialect: ResolvedDialect): SemanticParse {
  const database = DATABASE[dialect];
  if (!database) {
    return {
      ok: false,
      error: { message: `${dialect} 暂不使用语义解析，已走结构模式` },
    };
  }

  try {
    const ast = parser.astify(sql, {
      database,
      parseOptions: { includeLocations: true },
    });
    return { ok: true, ast };
  } catch (error) {
    const value = error as {
      message?: string;
      location?: { start?: { line?: number; column?: number } };
    };
    return {
      ok: false,
      error: {
        message: value.message ?? 'SQL 解析失败',
        line: value.location?.start?.line,
        column: value.location?.start?.column,
      },
    };
  }
}

interface AstNode {
  type?: string;
  loc?: {
    start?: { offset?: number; line?: number };
    end?: { offset?: number; line?: number };
  };
  table?: string | AstNode;
  as?: string | { value?: string };
  join?: string;
  on?: AstNode;
  expr?: AstNode;
  ast?: AstNode;
  columns?: AstNode[];
  name?: string | { value?: string };
  args?: unknown;
  over?: unknown;
  [key: string]: unknown;
}

function nodeLoc(node: AstNode | undefined): { offset?: number; line?: number } {
  return node?.loc?.start ?? {};
}

function exprText(sql: string, node: AstNode | undefined): string {
  const start = node?.loc?.start?.offset;
  const end = node?.loc?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number') {
    return sql.slice(start, end).trim();
  }
  return '';
}

function aliasOf(value: AstNode['as']): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.value === 'string') return value.value;
  return undefined;
}

function nameOf(value: AstNode['name']): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.value === 'string') return value.value;
  return undefined;
}

function collectRefs(node: unknown, result: Array<{ table?: string; column: string }> = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, result);
    return result;
  }

  const value = node as AstNode;
  if (value.type === 'column_ref') {
    result.push({
      table: typeof value.table === 'string' ? value.table : undefined,
      column: String(value.column ?? ''),
    });
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'as') continue;
    collectRefs(child, result);
  }
  return result;
}

function transformOf(node: AstNode | undefined): LineageTransform {
  if (!node) return 'unknown';
  if (node.over) return 'window';
  switch (node.type) {
    case 'aggr_func':
      return 'aggregate';
    case 'window_func':
      return 'window';
    case 'case':
      return 'case';
    case 'cast':
      return 'cast';
    case 'function':
      return 'function';
    case 'column_ref':
      return 'direct';
    case 'number':
    case 'string':
    case 'single_quote_string':
    case 'null':
    case 'bool':
      return 'literal';
    default:
      return 'unknown';
  }
}

function joinTypeOf(join: string | undefined): JoinType {
  const value = (join ?? '').toUpperCase();
  if (value.includes('LEFT')) return 'left';
  if (value.includes('RIGHT')) return 'right';
  if (value.includes('FULL')) return 'full';
  if (value.includes('CROSS')) return 'cross';
  if (value) return 'inner';
  return 'unknown';
}

function sourceKind(
  table: string,
  cteNames: Set<string>,
): RelationSource['kind'] {
  return cteNames.has(table.toLowerCase()) ? 'cte' : 'table';
}

export function buildSemanticRelations(
  sql: string,
  ast: unknown,
  idPrefix: string,
): Relations {
  if (!ast || typeof ast !== 'object') {
    return { sources: [], joins: [], lineage: [] };
  }

  const root = ast as AstNode;
  const sources: RelationSource[] = [];
  const byKey = new Map<string, RelationSource>();
  const joins: RelationJoin[] = [];
  const cteNames = new Set<string>();

  if (Array.isArray(root.with)) {
    for (const cte of root.with as AstNode[]) {
      const name = nameOf(cte.name);
      if (name) cteNames.add(name.toLowerCase());
    }
  }

  const addSource = (
    name: string,
    alias: string | undefined,
    kind: RelationSource['kind'],
    line: number,
  ) => {
    const key = (alias ?? name).toLowerCase();
    const existing = byKey.get(key);
    if (existing) return existing;
    const source: RelationSource = {
      id: `${idPrefix}-sem-src-${sources.length + 1}`,
      name,
      alias,
      kind,
      line,
    };
    sources.push(source);
    byKey.set(key, source);
    if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), source);
    return source;
  };

  const mainRef: { source?: RelationSource } = {};
  const fromItems = (root.from as AstNode[] | undefined) ?? [];

  for (const item of fromItems) {
    const line = nodeLoc(item).line ?? 1;
    const alias = aliasOf(item.as);
    let source: RelationSource | undefined;

    if (typeof item.table === 'string') {
      source = addSource(item.table, alias, sourceKind(item.table, cteNames), line);
    } else if (item.table && typeof item.table === 'object') {
      source = addSource('子查询', alias, 'subquery', line);
    } else if (item.expr && typeof item.expr === 'object') {
      source = addSource('子查询', alias, 'subquery', line);
    }

    if (!source) continue;
    if (!mainRef.source) mainRef.source = source;

    if (item.join && mainRef.source && source.id !== mainRef.source.id) {
      joins.push({
        id: `${idPrefix}-sem-join-${joins.length + 1}`,
        from: mainRef.source.id,
        to: source.id,
        type: joinTypeOf(item.join),
        condition: item.on ? exprText(sql, item.on) || undefined : undefined,
        line,
      });
    }
  }

  const main = mainRef.source;

  // 逗号连接：from 中有多个基础表但没有 join
  if (main && joins.length === 0) {
    for (const source of sources.slice(1)) {
      joins.push({
        id: `${idPrefix}-sem-join-${joins.length + 1}`,
        from: main.id,
        to: source.id,
        type: 'unknown',
        condition: '逗号连接',
        line: source.line,
      });
    }
  }

  const lineage: LineageRow[] = [];
  const columns = (root.columns as AstNode[] | undefined) ?? [];
  for (const [index, column] of columns.entries()) {
    const expr = column.expr;
    const alias = aliasOf(column.as);
    const text = exprText(sql, expr) || alias || '表达式';
    const output = alias ?? compact(text, 28);

    if (expr?.type === 'star') {
      lineage.push({
        id: `${idPrefix}-sem-lineage-${index + 1}`,
        output,
        source: '全部字段',
        transform: 'unknown',
        line: nodeLoc(expr).line ?? 1,
        confidence: 'unknown',
      });
      continue;
    }

    const refs = collectRefs(expr);
    const resolved: string[] = [];
    let confidence: LineageRow['confidence'] = 'exact';

    for (const ref of refs) {
      if (!ref.column || ref.column === '*') {
        const source = ref.table ? byKey.get(ref.table.toLowerCase()) : undefined;
        resolved.push(source ? `${source.name}.*` : '全部字段');
        confidence = 'unknown';
        continue;
      }
      const source = ref.table
        ? byKey.get(ref.table.toLowerCase())
        : sources.length === 1
          ? sources[0]
          : undefined;
      if (source) {
        resolved.push(`${source.name}.${ref.column}`);
      } else {
        resolved.push(ref.table ? `${ref.table}.${ref.column}` : ref.column);
        confidence = 'partial';
      }
    }

    if (resolved.length === 0) {
      if (expr?.type === 'aggr_func' && String(expr.name ?? '').toUpperCase() === 'COUNT') {
        resolved.push('按行计数');
      } else {
        resolved.push('常量或表达式');
        confidence = 'unknown';
      }
    }

    lineage.push({
      id: `${idPrefix}-sem-lineage-${index + 1}`,
      output,
      source: [...new Set(resolved)].join(' + '),
      transform: transformOf(expr),
      line: nodeLoc(expr).line ?? 1,
      confidence,
    });
  }

  return { sources, joins, lineage };
}

function compact(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
