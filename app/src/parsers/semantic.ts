import { Parser } from 'node-sql-parser';
import type {
  ClauseKind,
  JoinType,
  LineageRow,
  LineageTransform,
  RelationJoin,
  RelationSource,
  RelationFilter,
  Relations,
  ResolvedDialect,
  SemanticClause,
  SemanticCte,
  SemanticJoinKey,
  SemanticQuery,
} from '../core/types';

const parser = new Parser();

const DATABASE: Partial<Record<ResolvedDialect, string>> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  tsql: 'TransactSQL',
  // node-sql-parser 没有单独的 DM8 语法；DM8 的常见查询/CTE 语法
  // 与 MySQL 分支兼容度最高，先用它做语义回退，失败再走结构模式。
  dm8: 'MySQL',
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
  stmt?: { ast?: AstNode } | AstNode;
  columns?: AstNode[];
  column?: string;
  value?: unknown;
  values?: AstNode;
  set?: AstNode[];
  from?: AstNode[];
  name?: string | { value?: string };
  args?: unknown;
  over?: unknown;
  operator?: string;
  left?: AstNode;
  right?: AstNode;
  where?: AstNode;
  having?: AstNode;
  groupby?: { columns?: AstNode[] };
  orderby?: Array<{ expr?: AstNode; type?: string }>;
  limit?: { value?: Array<{ value?: unknown }> };
  _next?: AstNode;
  set_op?: string;
  with?: Array<{
    name?: AstNode['name'];
    stmt?: { ast?: AstNode } | AstNode;
  }>;
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

function cteBody(cte: {
  stmt?: { ast?: AstNode } | AstNode;
}): AstNode | undefined {
  const stmt = cte.stmt;
  if (!stmt) return undefined;
  return (stmt as { ast?: AstNode }).ast ?? (stmt as AstNode);
}

function nameOf(value: AstNode['name']): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.value === 'string') return value.value;
  return undefined;
}

function collectCtePhysicalTables(
  body: AstNode,
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
  result: Array<{ name: string; line: number }>,
): void {
  for (const item of (body.from as AstNode[] | undefined) ?? []) {
    if (typeof item.table !== 'string') continue;
    const key = item.table.toLowerCase();
    const nested = cteMap.get(key);
    if (nested && !visited.has(key)) {
      visited.add(key);
      collectCtePhysicalTables(nested, cteMap, visited, result);
      continue;
    }
    result.push({ name: item.table, line: nodeLoc(item).line ?? 1 });
  }
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

interface ExpandedColumn {
  output: string;
  source: string;
  via?: string[];
  transform: LineageTransform;
  line: number;
  confidence: LineageRow['confidence'];
}

function columnOutputName(
  sql: string,
  column: AstNode,
): string | null {
  const alias = aliasOf(column.as);
  if (alias) return alias;
  if (column.expr?.type === 'column_ref') {
    return String(column.expr.column ?? '') || null;
  }
  const text = textOf(sql, column.expr);
  return text ? compact(text, 28) : null;
}

function expandStarColumns(
  sql: string,
  item: AstNode,
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
): ExpandedColumn[] | null {
  let queryAst: AstNode | undefined;
  let sourceLabel: string | undefined;

  if (typeof item.table === 'string') {
    const cte = cteMap.get(item.table.toLowerCase());
    if (!cte) return null;
    queryAst = cte;
    sourceLabel = item.table;
  } else {
    queryAst =
      item.expr?.ast ??
      (item.table && typeof item.table === 'object' ? item.table : undefined);
    sourceLabel = aliasOf(item.as) ?? '子查询';
  }

  if (!queryAst?.columns?.length) return null;

  const result: ExpandedColumn[] = [];
  for (const column of queryAst.columns) {
    const output = columnOutputName(sql, column);
    if (!output || output === '*') return null;

    const resolved = resolveColumnInQuery(
      queryAst,
      output,
      cteMap,
      new Set([...visited, (sourceLabel ?? '').toLowerCase()]),
    );
    const via = [sourceLabel, ...(resolved?.via ?? [])].filter(
      (value): value is string => Boolean(value),
    );

    result.push({
      output,
      source: resolved?.source ?? `${sourceLabel}.${output}`,
      via: via.length > 0 ? [...new Set(via)] : undefined,
      transform: resolved?.transform ?? transformOf(column.expr),
      line: nodeLoc(column.expr).line ?? 1,
      confidence: resolved ? (resolved.exact ? 'exact' : 'partial') : 'partial',
    });
  }
  return result;
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
  if (root.type === 'insert' || root.type === 'update' || root.type === 'delete') {
    return buildDmlRelations(sql, root, idPrefix);
  }
  const sources: RelationSource[] = [];
  const byKey = new Map<string, RelationSource>();
  const joins: RelationJoin[] = [];
  const dependencies: RelationJoin[] = [];
  const filters: RelationFilter[] = [];
  const cteNames = new Set<string>();
  const cteMap = new Map<string, AstNode>();

  if (Array.isArray(root.with)) {
    for (const cte of root.with as AstNode[]) {
      const name = nameOf(cte.name);
      const body = cteBody(cte);
      if (!name) continue;
      cteNames.add(name.toLowerCase());
      if (body) cteMap.set(name.toLowerCase(), body);
    }
  }

  const addSource = (
    name: string,
    alias: string | undefined,
    kind: RelationSource['kind'],
    line: number,
    meta?: { parentId?: string; depth?: number; queryId?: string },
  ) => {
    const isRoot = !meta?.queryId;
    const key = isRoot
      ? (alias ?? name).toLowerCase()
      : `${meta.queryId}:${(alias ?? name).toLowerCase()}`;
    const existing = isRoot ? byKey.get(key) : undefined;
    if (existing) return existing;
    const source: RelationSource = {
      id: `${idPrefix}-sem-src-${sources.length + 1}`,
      name,
      alias,
      kind,
      line,
      ...(meta ?? {}),
    };
    sources.push(source);
    if (isRoot) {
      byKey.set(key, source);
      if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), source);
    }
    return source;
  };

  const addFilter = (
    queryAst: AstNode,
    queryId: string,
    parentId: string | undefined,
    depth: number,
  ) => {
    if (!queryAst.where) return;
    const raw = textOf(sql, queryAst.where).trim();
    if (!raw) return;
    const normalized = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .trim();
    filters.push({
      id: `${idPrefix}-filter-${filters.length + 1}`,
      queryId,
      parentId,
      depth,
      text: raw,
      line: nodeLoc(queryAst.where).line ?? 1,
      placeholder: /^1\s*=\s*1$/i.test(normalized),
    });
  };

  let nestedSeq = 0;

  function collectNested(
    queryAst: AstNode,
    parentSource: RelationSource | undefined,
    depth: number,
    queryId: string,
  ): void {
    const items = (queryAst.from as AstNode[] | undefined) ?? [];
    let firstChild: RelationSource | undefined;

    for (const item of items) {
      const line = nodeLoc(item).line ?? 1;
      const alias = aliasOf(item.as);
      let source: RelationSource | undefined;

      if (typeof item.table === 'string') {
        source = addSource(item.table, alias, sourceKind(item.table, cteNames), line, {
          parentId: parentSource?.id,
          depth,
          queryId,
        });
      } else if (item.table && typeof item.table === 'object') {
        source = addSource('子查询', alias, 'subquery', line, {
          parentId: parentSource?.id,
          depth,
          queryId,
        });
      } else if (item.expr && typeof item.expr === 'object') {
        source = addSource('子查询', alias, 'subquery', line, {
          parentId: parentSource?.id,
          depth,
          queryId,
        });
      }

      if (!source) continue;
      if (!firstChild) firstChild = source;

      if (item.join && firstChild && source.id !== firstChild.id) {
        joins.push({
          id: `${idPrefix}-sem-join-${joins.length + 1}`,
          from: firstChild.id,
          to: source.id,
          type: joinTypeOf(item.join),
          condition: item.on ? exprText(sql, item.on) || undefined : undefined,
          line,
          queryId,
          parentId: parentSource?.id,
          depth,
        });
      }

      const nestedAst =
        item.expr?.ast ??
        (item.table && typeof item.table === 'object' ? item.table : undefined);
      if (nestedAst) {
        nestedSeq += 1;
        collectNested(
          nestedAst,
          source,
          depth + 1,
          `${idPrefix}-q-sub-${nestedSeq}`,
        );
      }
    }

    addFilter(queryAst, queryId, parentSource?.id, depth);

    if (parentSource && firstChild) {
      dependencies.push({
        id: `${idPrefix}-sem-subquery-${dependencies.length + 1}`,
        from: parentSource.id,
        to: firstChild.id,
        type: 'unknown',
        condition: '子查询',
        line: firstChild.line,
        queryId,
        parentId: parentSource.id,
        depth,
      });
    }
  }

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

    const nestedAst =
      item.expr?.ast ??
      (item.table && typeof item.table === 'object' ? item.table : undefined);
    if (nestedAst) {
      nestedSeq += 1;
      collectNested(nestedAst, source, 1, `${idPrefix}-q-sub-${nestedSeq}`);
    }

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
  addFilter(root, `${idPrefix}-q0`, undefined, 0);

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

  // CTE 追底层表：只把依赖边放在 dependencies，不计入 joins 指标
  for (const source of [...sources]) {
    if (source.kind !== 'cte') continue;
    const body = cteMap.get(source.name.toLowerCase());
    if (!body) continue;
    const tables: Array<{ name: string; line: number }> = [];
    collectCtePhysicalTables(body, cteMap, new Set([source.name.toLowerCase()]), tables);
    for (const table of tables) {
      const physical = addSource(table.name, undefined, 'table', table.line);
      if (physical.id === source.id) continue;
      dependencies.push({
        id: `${idPrefix}-sem-cte-${dependencies.length + 1}`,
        from: source.id,
        to: physical.id,
        type: 'unknown',
        condition: 'CTE 依赖',
        line: table.line,
      });
    }
  }

  const lineage: LineageRow[] = [];
  const columns = (root.columns as AstNode[] | undefined) ?? [];
  for (const [index, column] of columns.entries()) {
    const expr = column.expr;
    const alias = aliasOf(column.as);
    const text = exprText(sql, expr) || alias || '表达式';
    const isStar =
      expr?.type === 'star' ||
      (expr?.type === 'column_ref' && expr.column === '*');
    const output = alias ?? (isStar ? '*' : compact(text, 28));

    if (isStar) {
      const fromItems = (root.from as AstNode[] | undefined) ?? [];
      const expanded =
        fromItems.length === 1
          ? expandStarColumns(sql, fromItems[0]!, cteMap, new Set())
          : null;

      if (expanded && expanded.length > 0) {
        expanded.forEach((field, fieldIndex) => {
          lineage.push({
            id: `${idPrefix}-sem-lineage-${index + 1}-${fieldIndex + 1}`,
            output: field.output,
            source: field.source,
            via: field.via,
            transform: field.transform,
            line: field.line,
            confidence: field.confidence,
          });
        });
        continue;
      }

      const starSources = [
        ...new Set(
          fromItems
            .map((item) =>
              typeof item.table === 'string' ? item.table : '子查询',
            )
            .filter(Boolean),
        ),
      ];
      lineage.push({
        id: `${idPrefix}-sem-lineage-${index + 1}`,
        output,
        source:
          starSources.length > 0
            ? starSources.map((name) => `${name}.*`).join(' / ')
            : '全部字段',
        transform: 'unknown',
        line: nodeLoc(expr).line ?? 1,
        confidence: 'unknown',
      });
      continue;
    }

    const refs = collectRefs(expr);
    const resolved: string[] = [];
    const via: string[] = [];
    let confidence: LineageRow['confidence'] = 'exact';
    let derivedTransform: LineageTransform | undefined;

    for (const ref of refs) {
      if (!ref.column || ref.column === '*') {
        const source = ref.table ? byKey.get(ref.table.toLowerCase()) : undefined;
        resolved.push(source ? `${source.name}.*` : '全部字段');
        confidence = 'unknown';
        continue;
      }

      const physical = resolveRef(root, ref, cteMap, new Set());
      if (physical) {
        resolved.push(physical.source);
        via.push(...physical.via);
        if (physical.transform && physical.transform !== 'direct') {
          derivedTransform = physical.transform;
        }
        if (!physical.exact) confidence = 'partial';
        continue;
      }

      const source = ref.table
        ? byKey.get(ref.table.toLowerCase())
        : sources.length === 1
          ? sources[0]
          : undefined;
      if (source) {
        resolved.push(`${source.name}.${ref.column}`);
        if (source.kind === 'cte' || source.kind === 'subquery') confidence = 'partial';
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
      via: via.length > 0 ? [...new Set(via)] : undefined,
      transform: derivedTransform ?? transformOf(expr),
      line: nodeLoc(expr).line ?? 1,
      confidence,
    });
  }

  // UNION 分支：把各分支血缘并到对应输出列，并在图里加一条分支依赖边
  const confidenceRank: Record<LineageRow['confidence'], number> = {
    exact: 0,
    partial: 1,
    unknown: 2,
  };
  let nextBranch = root._next;
  let branchIndex = 0;
  while (nextBranch) {
    branchIndex += 1;
    const branchAst: AstNode = { ...nextBranch, _next: undefined };
    const branchRelations = buildSemanticRelations(
      sql,
      branchAst,
      `${idPrefix}-union-${branchIndex}`,
    );
    const branchMain = branchRelations.sources[0];
    if (main && branchMain) {
      dependencies.push({
        id: `${idPrefix}-sem-union-${branchIndex}`,
        from: main.id,
        to: branchMain.id,
        type: 'unknown',
        condition: `${(root.set_op ?? 'union').toUpperCase()} 分支 ${branchIndex + 1}`,
        line: branchMain.line,
      });
    }
    sources.push(...branchRelations.sources);
    joins.push(...branchRelations.joins);
    dependencies.push(...(branchRelations.dependencies ?? []));

    branchRelations.lineage.forEach((row, index) => {
      const base = lineage[index];
      const label = `分支 ${branchIndex}`;
      if (base) {
        const via = [...(base.via ?? []), ...(row.via ?? [])];
        lineage[index] = {
          ...base,
          source: `${base.source} + ${label}: ${row.source}`,
          via: via.length > 0 ? [...new Set(via)] : undefined,
          confidence:
            confidenceRank[row.confidence] > confidenceRank[base.confidence]
              ? row.confidence
              : base.confidence,
        };
      } else {
        lineage.push({
          ...row,
          id: `${idPrefix}-sem-lineage-union-${branchIndex}-${index + 1}`,
          output: `${label} · ${row.output}`,
        });
      }
    });

    nextBranch = nextBranch._next;
  }

  return { sources, joins, dependencies, filters, lineage };
}

function buildDmlRelations(
  sql: string,
  root: AstNode,
  idPrefix: string,
): Relations {
  const sources: RelationSource[] = [];
  const byKey = new Map<string, RelationSource>();
  const joins: RelationJoin[] = [];
  const dependencies: RelationJoin[] = [];
  const filters: RelationFilter[] = [];
  const lineage: LineageRow[] = [];
  const target = tableItems(root.table)[0];

  const addSource = (
    name: string,
    alias: string | undefined,
    line: number,
    role: RelationSource['role'],
  ): RelationSource => {
    const key = (alias ?? name).toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (role === 'target') existing.role = 'target';
      return existing;
    }
    const source: RelationSource = {
      id: `${idPrefix}-sem-src-${sources.length + 1}`,
      name,
      alias,
      kind: 'table',
      line,
      role,
    };
    sources.push(source);
    byKey.set(key, source);
    if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), source);
    return source;
  };

  const addFilter = (queryAst: AstNode): void => {
    if (!queryAst.where) return;
    const raw = textOf(sql, queryAst.where).trim();
    if (!raw) return;
    const normalized = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .trim();
    filters.push({
      id: `${idPrefix}-filter-${filters.length + 1}`,
      queryId: `${idPrefix}-q0`,
      depth: 0,
      text: raw,
      line: nodeLoc(queryAst.where).line ?? 1,
      placeholder: /^1\s*=\s*1$/i.test(normalized),
    });
  };

  const relate = (
    from: RelationSource,
    to: RelationSource,
    condition: string,
    line: number,
  ): void => {
    dependencies.push({
      id: `${idPrefix}-sem-dml-${dependencies.length + 1}`,
      from: from.id,
      to: to.id,
      type: 'unknown',
      condition,
      line,
    });
  };

  const targetSource = target ? addSource(
    tableNameOf(target) || '目标表',
    aliasOf(target.as),
    nodeLoc(target).line ?? nodeLoc(root).line ?? 1,
    'target',
  ) : undefined;

  if (root.type === 'insert' && targetSource) {
    const values = root.values;
    if (values?.type === 'select') {
      const sourceRelations = buildSemanticRelations(
        sql,
        values,
        `${idPrefix}-dml-src`,
      );
      for (const source of sourceRelations.sources) {
        source.role = 'source';
        sources.push(source);
      }
      joins.push(...sourceRelations.joins);
      dependencies.push(...(sourceRelations.dependencies ?? []));
      filters.push(...(sourceRelations.filters ?? []));
      const sourceMain = sourceRelations.sources[0];
      if (sourceMain) {
        relate(targetSource, sourceMain, '来源表', sourceMain.line);
      }

      const rawColumns = root.columns as unknown[] | undefined;
      const targetColumns = (Array.isArray(rawColumns) ? rawColumns : []).filter(
        (column): column is string => typeof column === 'string',
      );
      const count = Math.max(targetColumns.length, sourceRelations.lineage.length);
      for (let index = 0; index < count; index += 1) {
        const sourceRow = sourceRelations.lineage[index];
        const output = targetColumns[index] ?? sourceRow?.output ?? `列 ${index + 1}`;
        lineage.push({
          id: `${idPrefix}-sem-lineage-${index + 1}`,
          output,
          source: sourceRow?.source ?? '来源字段',
          via: sourceRow?.via,
          transform: sourceRow?.transform ?? 'direct',
          line: sourceRow?.line ?? targetSource.line,
          confidence: sourceRow?.confidence ?? 'partial',
        });
      }
    } else {
      const rows = root.values?.values;
      const firstRow =
        Array.isArray(rows) && rows[0]?.type === 'expr_list'
          ? (rows[0].value as AstNode[] | undefined)
          : undefined;
      const rawColumns = root.columns as unknown[] | undefined;
      const targetColumns = (Array.isArray(rawColumns) ? rawColumns : []).filter(
        (column): column is string => typeof column === 'string',
      );
      for (const [index, column] of targetColumns.entries()) {
        const value = firstRow?.[index];
        lineage.push({
          id: `${idPrefix}-sem-lineage-${index + 1}`,
          output: column,
          source: value ? '常量或表达式' : '未提供值',
          transform: value ? (value.type === 'number' || value.type === 'single_quote_string' ? 'literal' : 'unknown') : 'unknown',
          line: value ? nodeLoc(value).line ?? targetSource.line : targetSource.line,
          confidence: 'unknown',
        });
      }
    }
  }

  if (root.type === 'update' && targetSource) {
    for (const item of tableItems(root.table).slice(1)) {
      const name = tableNameOf(item);
      if (!name) continue;
      const source = addSource(
        name,
        aliasOf(item.as),
        nodeLoc(item).line ?? targetSource.line,
        'source',
      );
      joins.push({
        id: `${idPrefix}-sem-join-${joins.length + 1}`,
        from: targetSource.id,
        to: source.id,
        type: joinTypeOf(item.join),
        condition: item.on ? exprText(sql, item.on) || undefined : undefined,
        line: nodeLoc(item).line ?? targetSource.line,
      });
    }

    for (const assignment of (root.set as AstNode[] | undefined) ?? []) {
      const output = assignment.column ?? '列';
      const value = assignment.value as AstNode | undefined;
      const refs = collectRefs(value);
      const resolved: string[] = [];
      for (const ref of refs) {
        if (!ref.column) continue;
        const source = ref.table
          ? byKey.get(ref.table.toLowerCase())
          : sources[0];
        resolved.push(source ? `${source.name}.${ref.column}` : ref.column);
      }
      const isConstant =
        value?.type === 'number' ||
        value?.type === 'single_quote_string' ||
        value?.type === 'double_quote_string' ||
        value?.type === 'null' ||
        value?.type === 'bool';
      lineage.push({
        id: `${idPrefix}-sem-lineage-${lineage.length + 1}`,
        output,
        source: resolved.length > 0 ? [...new Set(resolved)].join(' + ') : isConstant ? '常量或表达式' : exprText(sql, value) || '表达式',
        transform: isConstant ? 'literal' : transformOf(value),
        line: nodeLoc(value).line ?? targetSource.line,
        confidence: resolved.length > 0 ? 'partial' : 'unknown',
      });
    }
    addFilter(root);
  }

  if (root.type === 'delete') {
    const items = tableItems(root.from);
    const targetAlias = targetSource?.alias ?? targetSource?.name.toLowerCase();
    const fromTarget = items.find((item) => {
      const alias = aliasOf(item.as);
      return (
        (alias && targetAlias && alias.toLowerCase() === targetAlias) ||
        tableNameOf(item).toLowerCase() === (targetSource?.name ?? '').toLowerCase()
      );
    });
    if (targetSource && fromTarget) {
      targetSource.name = tableNameOf(fromTarget) || targetSource.name;
      targetSource.alias = aliasOf(fromTarget.as) ?? targetSource.alias;
    }
    let targetSeen = false;
    for (const item of items) {
      const name = tableNameOf(item);
      if (!name) continue;
      const alias = aliasOf(item.as);
      const isTarget =
        Boolean(targetSource) &&
        (name.toLowerCase() === targetSource!.name.toLowerCase() ||
          (alias && alias.toLowerCase() === (targetSource!.alias ?? '').toLowerCase()));
      const source = addSource(
        name,
        alias,
        nodeLoc(item).line ?? targetSource?.line ?? 1,
        isTarget ? 'target' : 'source',
      );
      if (isTarget) targetSeen = true;
      const previous = sources.filter((candidate) => candidate.id !== source.id).at(-1);
      if (item.join && previous) {
        joins.push({
          id: `${idPrefix}-sem-join-${joins.length + 1}`,
          from: previous.id,
          to: source.id,
          type: joinTypeOf(item.join),
          condition: item.on ? exprText(sql, item.on) || undefined : undefined,
          line: nodeLoc(item).line ?? source.line,
        });
      }
    }
    if (targetSource && !targetSeen) {
      targetSource.role = 'source';
    }
    addFilter(root);
  }

  return { sources, joins, dependencies, filters, lineage };
}

function tableItems(value: unknown): AstNode[] {
  if (Array.isArray(value)) return value as AstNode[];
  if (value && typeof value === 'object') return [value as AstNode];
  return [];
}

function tableNameOf(item: AstNode): string {
  if (typeof item.table === 'string') return item.table;
  if (item.table && typeof item.table === 'object') {
    const nested = item.table as AstNode;
    if (typeof nested.table === 'string') return nested.table;
  }
  return '';
}

interface ResolvedRef {
  source: string;
  via: string[];
  exact: boolean;
  transform?: LineageTransform;
}

function findFromItem(queryAst: AstNode, tableOrAlias?: string): AstNode | undefined {
  const items = queryAst.from ?? [];
  if (!tableOrAlias) return items.length === 1 ? items[0] : undefined;
  const key = tableOrAlias.toLowerCase();
  return items.find((item) => {
    const alias = aliasOf(item.as)?.toLowerCase();
    const table = typeof item.table === 'string' ? item.table.toLowerCase() : undefined;
    return alias === key || table === key;
  });
}

function resolveRef(
  queryAst: AstNode,
  ref: { table?: string; column: string },
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
): ResolvedRef | null {
  if (!ref.column || ref.column === '*') return null;
  const item = findFromItem(queryAst, ref.table);
  if (!item) return null;

  const alias = aliasOf(item.as);

  if (typeof item.table === 'string') {
    const tableName = item.table;
    const key = tableName.toLowerCase();
    const cteAst = cteMap.get(key);

    if (cteAst) {
      if (visited.has(key)) return null;
      const nested = resolveColumnInQuery(
        cteAst,
        ref.column,
        cteMap,
        new Set([...visited, key]),
      );
      if (!nested) return null;
      return {
        source: nested.source,
        via: [tableName, ...nested.via],
        exact: nested.exact,
        transform: nested.transform,
      };
    }

    return { source: `${tableName}.${ref.column}`, via: [], exact: true };
  }

  const nestedAst =
    item.expr?.ast ??
    (item.table && typeof item.table === 'object' ? item.table : undefined);
  if (!nestedAst) return null;

  const key = (alias ?? '子查询').toLowerCase();
  if (visited.has(key)) return null;
  const nested = resolveColumnInQuery(
    nestedAst,
    ref.column,
    cteMap,
    new Set([...visited, key]),
  );
  if (!nested) return null;
  return {
    source: nested.source,
    via: [alias ?? '子查询', ...nested.via],
    exact: nested.exact,
    transform: nested.transform,
  };
}

function resolveColumnInQuery(
  queryAst: AstNode,
  column: string,
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
): ResolvedRef | null {
  const target = column.toLowerCase();

  // 子查询输出列可能是派生列，例如 COUNT(*) AS CNT。
  // 也必须支持没有 AS 的直接列引用，例如 t1.value_1。
  for (const item of queryAst.columns ?? []) {
    const alias = aliasOf(item.as);
    const expr = item.expr;
    if (!expr) continue;

    const outputName =
      alias ??
      (expr.type === 'column_ref' ? String(expr.column ?? '') : undefined);
    if (!outputName || outputName.toLowerCase() !== target) continue;

    const transform = transformOf(expr);
    const refs = collectRefs(expr);

    if (
      expr.type === 'aggr_func' &&
      String(expr.name ?? '').toUpperCase() === 'COUNT' &&
      refs.every((ref) => !ref.column || ref.column === '*')
    ) {
      return {
        source: '按行计数',
        via: alias ? [alias] : [],
        exact: true,
        transform: 'aggregate',
      };
    }

    if (refs.length === 0) {
      const literal = ['string', 'single_quote_string', 'number', 'null', 'bool'].includes(
        expr.type ?? '',
      );
      return {
        source: literal ? '常量' : '表达式',
        via: alias ? [alias] : [],
        exact: false,
        transform,
      };
    }

    const nested = resolveExpression(queryAst, expr, cteMap, visited);
    if (!nested) return null;
    return {
      ...nested,
      via: alias ? [alias, ...nested.via] : nested.via,
      transform,
    };
  }

  const items = queryAst.from ?? [];
  if (items.length !== 1) return null;
  const table = typeof items[0]!.table === 'string' ? items[0]!.table : undefined;
  return resolveRef(queryAst, { table, column }, cteMap, visited);
}

function resolveExpression(
  queryAst: AstNode,
  expr: AstNode | undefined,
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
): ResolvedRef | null {
  const refs = collectRefs(expr);
  if (refs.length === 0) return null;

  const sources: string[] = [];
  const via: string[] = [];
  let exact = true;

  for (const ref of refs) {
    const result = resolveRef(queryAst, ref, cteMap, visited);
    if (!result) return null;
    sources.push(result.source);
    via.push(...result.via);
    if (!result.exact) exact = false;
  }

  return {
    source: [...new Set(sources)].join(' + '),
    via: [...new Set(via)],
    exact,
  };
}

function compact(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function textOf(sql: string, node: AstNode | undefined): string {
  const start = node?.loc?.start?.offset;
  const end = node?.loc?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number') {
    return sql.slice(start, end).trim();
  }
  return '';
}

function lineOf(node: AstNode | undefined): number {
  return node?.loc?.start?.line ?? 1;
}

function endLineOf(node: AstNode | undefined): number {
  return node?.loc?.end?.line ?? lineOf(node);
}

function columnLabel(sql: string, node: AstNode | undefined): string {
  if (!node) return '表达式';
  if (node.type === 'column_ref') {
    return node.table ? `${node.table}.${String(node.column)}` : String(node.column);
  }
  return textOf(sql, node) || node.type || '表达式';
}

function countPredicates(node: AstNode | undefined): number {
  if (!node) return 0;
  let count = 0;
  const stack: AstNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const operator = String(current.operator ?? '').toUpperCase();
    if (
      current.type === 'binary_expr' &&
      (operator === 'AND' || operator === 'OR') &&
      current.left &&
      current.right
    ) {
      stack.push(current.left, current.right);
    } else {
      count += 1;
    }
  }
  return count;
}

function collectSelectNodes(
  node: unknown,
  result: AstNode[],
  seen: WeakSet<object>,
): void {
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);

    const value = current as AstNode;
    if (value.type === 'select') {
      result.push(value);
      continue;
    }

    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!;
      if (key === 'loc' || key === 'as') continue;
      stack.push(child);
    }
  }
}

function columnRefLabel(node: AstNode | undefined): string {
  if (!node || node.type !== 'column_ref') return '';
  return node.table ? `${node.table}.${String(node.column)}` : String(node.column);
}

function collectJoinKeys(node: AstNode | undefined, result: SemanticJoinKey[]): void {
  if (!node) return;
  if (node.type === 'binary_expr' && String(node.operator) === '=') {
    const left = columnRefLabel(node.left);
    const right = columnRefLabel(node.right);
    if (left && right) {
      result.push({ left, right, operator: '=', line: lineOf(node) });
    }
  }
  collectJoinKeys(node.left, result);
  collectJoinKeys(node.right, result);
}

function isCorrelated(ast: AstNode, parentKeys: Set<string>): boolean {
  return collectRefs(ast).some(
    (ref) => Boolean(ref.table && parentKeys.has(ref.table.toLowerCase())),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSemanticClauses(
  sql: string,
  root: AstNode,
  tables: string[],
): SemanticClause[] {
  const clauses: SemanticClause[] = [];
  const tablePatterns = tables.map(
    (table) => new RegExp(`\\b${escapeRegExp(table)}\\b`, 'i'),
  );
  const containsTable = (text: string) =>
    tablePatterns.some((pattern) => pattern.test(text));

  const push = (
    kind: SemanticClause['kind'],
    label: string,
    startNode: AstNode | undefined,
    endNode: AstNode | undefined,
    text: string,
    forceTable = false,
  ) => {
    if (!startNode) return;
    clauses.push({
      kind,
      label,
      startLine: lineOf(startNode),
      endLine: endLineOf(endNode ?? startNode),
      text,
      hasTable: forceTable || containsTable(text),
    });
  };

  const columns = root.columns ?? [];
  if (columns.length > 0) {
    const text = columns
      .map((column) => textOf(sql, column.expr) || aliasOf(column.as) || '')
      .filter(Boolean)
      .join(', ');
    push(
      'select',
      'SELECT',
      columns[0]!.expr,
      columns[columns.length - 1]!.expr,
      text || textOf(sql, root),
    );
  }

  const fromItems = root.from ?? [];
  const base = fromItems.find((item) => !item.join) ?? fromItems[0];
  if (base) {
    push('from', 'FROM', base, base, textOf(sql, base), true);
  }

  for (const item of fromItems) {
    if (!item.join) continue;
    const end = item.on ?? item;
    const condition = item.on ? ` ON ${textOf(sql, item.on)}` : '';
    push('join', 'JOIN', item, end, `${textOf(sql, item)}${condition}`.trim(), true);
  }

  if (root.where) {
    push('where', 'WHERE', root.where, root.where, textOf(sql, root.where));
  }

  const groupColumns = root.groupby?.columns ?? [];
  if (groupColumns.length > 0) {
    push(
      'groupBy',
      'GROUP BY',
      groupColumns[0],
      groupColumns[groupColumns.length - 1],
      groupColumns.map((column) => columnLabel(sql, column)).join(', '),
    );
  }

  if (root.having) {
    push('having', 'HAVING', root.having, root.having, textOf(sql, root.having));
  }

  const orderItems = root.orderby ?? [];
  if (orderItems.length > 0) {
    const text = orderItems
      .map((item) => `${columnLabel(sql, item.expr)}${item.type === 'DESC' ? ' DESC' : ' ASC'}`)
      .join(', ');
    push(
      'orderBy',
      'ORDER BY',
      orderItems[0]?.expr,
      orderItems[orderItems.length - 1]?.expr,
      text,
    );
  }

  if (root.limit) {
    push('limit', 'LIMIT', root.limit, root.limit, textOf(sql, root.limit));
  }

  return clauses;
}

export function buildSemanticQuery(
  sql: string,
  ast: unknown,
  idPrefix: string,
  kind: 'main' | 'cte' | 'subquery' = 'main',
  name?: string,
  scopeCtes?: Set<string>,
  depth = 0,
  origin?: SemanticQuery['origin'],
  parentClauseKind?: ClauseKind,
  parentId?: string,
): SemanticQuery {
  const root = (ast ?? {}) as AstNode;
  const startLine = lineOf(root);
  const endLine = endLineOf(root);

  const visibleCtes = new Set(scopeCtes ?? []);
  if (kind === 'main' && Array.isArray(root.with)) {
    for (const cte of root.with) {
      const cteName = nameOf(cte.name);
      if (cteName) visibleCtes.add(cteName.toLowerCase());
    }
  }

  const ctes: SemanticCte[] = [];
  if (kind === 'main' && Array.isArray(root.with)) {
    root.with.forEach((cte, index) => {
      const cteName = nameOf(cte.name) ?? `cte_${index + 1}`;
      const body = cteBody(cte);
      if (!body) return;
      const query = buildSemanticQuery(
        sql,
        body,
        `${idPrefix}-cte-${index + 1}`,
        'cte',
        cteName,
        visibleCtes,
        0,
        undefined,
        'with',
        idPrefix,
      );
      ctes.push({
        name: cteName,
        tables: query.tables,
        query,
        description: describeQueryPurpose(query),
      });
    });
  }

  const sources: RelationSource[] = [];
  const subqueries: SemanticQuery[] = [];
  const pending: Array<{ query: SemanticQuery; ast: AstNode }> = [];
  const fromItems = root.from ?? [];
  const seen = new WeakSet<object>();

  const addSubquery = (
    subAst: AstNode,
    alias: string | undefined,
    subOrigin: SemanticQuery['origin'],
    subParentKind: ClauseKind,
  ) => {
    const query = buildSemanticQuery(
      sql,
      subAst,
      `${idPrefix}-sub-${subqueries.length + 1}`,
      'subquery',
      alias,
      visibleCtes,
      depth + 1,
      subOrigin,
      subParentKind,
      idPrefix,
    );
    subqueries.push(query);
    pending.push({ query, ast: subAst });
  };

  fromItems.forEach((item, index) => {
    const alias = aliasOf(item.as);
    const line = lineOf(item);
    let nested: AstNode | undefined;

    if (typeof item.table === 'string') {
      sources.push({
        id: `${idPrefix}-sem-src-${index + 1}`,
        name: item.table,
        alias,
        kind: visibleCtes.has(item.table.toLowerCase()) ? 'cte' : 'table',
        line,
      });
      return;
    }

    if (item.expr?.ast) nested = item.expr.ast;
    else if (item.table && typeof item.table === 'object') nested = item.table;
    if (!nested) return;

    sources.push({
      id: `${idPrefix}-sem-src-${index + 1}`,
      name: '子查询',
      alias,
      kind: 'subquery',
      line,
    });
    seen.add(nested);
    addSubquery(nested, alias, 'from', item.join ? 'join' : 'from');
  });

  const addExpressionSubqueries = (
    node: unknown,
    subOrigin: SemanticQuery['origin'],
    subParentKind: ClauseKind,
  ) => {
    const found: AstNode[] = [];
    collectSelectNodes(node, found, seen);
    for (const subAst of found) {
      addSubquery(subAst, undefined, subOrigin, subParentKind);
    }
  };

  addExpressionSubqueries(root.where, 'where', 'where');
  addExpressionSubqueries(root.having, 'having', 'having');
  for (const column of root.columns ?? []) {
    addExpressionSubqueries(column.expr, 'select', 'select');
  }
  for (const item of fromItems) {
    if (item.join && item.on) {
      addExpressionSubqueries(item.on, 'from', 'join');
    }
  }

  const parentKeys = new Set<string>();
  for (const source of sources) {
    parentKeys.add(source.name.toLowerCase());
    if (source.alias) parentKeys.add(source.alias.toLowerCase());
  }
  for (const item of pending) {
    item.query.correlated = isCorrelated(item.ast, parentKeys);
  }

  const joinKeys: SemanticJoinKey[] = [];
  for (const item of fromItems) {
    if (item.join && item.on) collectJoinKeys(item.on, joinKeys);
  }

  const tables = [
    ...new Set(
      sources
        .filter((source) => source.kind === 'table')
        .map((source) => source.name),
    ),
  ];
  const clauses = buildSemanticClauses(sql, root, tables);
  const hasAggregate = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(
    clauses.map((clause) => clause.text).join(' '),
  );
  const limitValue = root.limit?.value?.[0]?.value;

  const branches: SemanticQuery[] = [];
  let next = root._next;
  let operator = root.set_op;
  let branchIndex = 0;
  while (next) {
    branchIndex += 1;
    const branchAst: AstNode = { ...next, _next: undefined };
    const branch = buildSemanticQuery(
      sql,
      branchAst,
      `${idPrefix}-union-${branchIndex}`,
      'subquery',
      undefined,
      visibleCtes,
      depth,
      'union',
      'union',
      idPrefix,
    );
    branch.branchOperator = operator;
    branches.push(branch);
    operator = next.set_op;
    next = next._next;
  }

  const result: SemanticQuery = {
    id: idPrefix,
    kind,
    name,
    origin,
    parentId,
    parentClauseKind,
    depth,
    startLine,
    endLine,
    sources,
    joins: fromItems.filter((item) => item.join).length,
    joinKeys,
    hasAggregate,
    whereCount: countPredicates(root.where),
    hasHaving: Boolean(root.having),
    groupBy: (root.groupby?.columns ?? []).map((column) =>
      columnLabel(sql, column),
    ),
    orderBy: (root.orderby ?? []).map((item) => {
      const label = columnLabel(sql, item.expr);
      return `${label}${item.type === 'DESC' ? ' 降序' : ' 升序'}`;
    }),
    limit: limitValue != null ? String(limitValue) : undefined,
    outputCount: root.columns?.length ?? 0,
    outputNames: (root.columns ?? []).map((column) => {
      const alias = aliasOf(column.as);
      if (alias) return alias;
      if (
        column.expr?.type === 'star' ||
        (column.expr?.type === 'column_ref' && column.expr.column === '*')
      ) {
        return '*';
      }
      return columnLabel(sql, column.expr) || '表达式';
    }),
    tables,
    clauses,
    ctes,
    subqueries,
    branches,
  };
  result.description = describeQueryPurpose(result);
  return result;
}

function sourceLabel(source: RelationSource): string {
  return source.alias ? `${source.name}（别名 ${source.alias}）` : source.name;
}

function collectPhysicalTables(
  query: SemanticQuery,
  byName: Map<string, SemanticCte>,
  visited: Set<string>,
  result: Set<string> = new Set(),
): string[] {
  for (const table of query.tables) result.add(table);

  for (const source of query.sources) {
    if (source.kind !== 'cte') continue;
    const key = source.name.toLowerCase();
    if (visited.has(key)) continue;
    const cte = byName.get(key);
    if (!cte) continue;
    visited.add(key);
    collectPhysicalTables(cte.query, byName, visited, result);
  }

  for (const subquery of query.subqueries) {
    collectPhysicalTables(subquery, byName, visited, result);
  }
  for (const branch of query.branches) {
    collectPhysicalTables(branch, byName, visited, result);
  }

  return [...result];
}

export function describeQueryPurpose(query: SemanticQuery): string {
  const parts: string[] = [];
  const sources = query.sources.map(sourceLabel);

  if (sources.length > 0) parts.push(`从 ${sources.join('、')} 取数`);
  else {
    const functions = ['CASE', 'SUBSTR', 'REPLACE', 'TRIM', 'TO_CHAR', 'SYSDATE'].filter(
      (name) => new RegExp(`\\b${name}\\b`, 'i').test(query.clauses.map((clause) => clause.text).join(' ')),
    );
    parts.push(
      functions.length > 0
        ? `无表输入，用 ${functions.join('/')} 生成派生字段`
        : '无表输入，生成派生字段',
    );
  }

  if (query.whereCount > 0) parts.push(`过滤 ${query.whereCount} 个条件`);

  const clauseText = query.clauses.map((clause) => clause.text).join(' ');
  const windowNames = [
    ...new Set(
      (clauseText.match(/\b(LAG|LEAD|ROW_NUMBER|RANK|DENSE_RANK|NTILE)\s*\(/gi) ?? []).map(
        (name) => name.replace(/\s*\($/, '').toUpperCase(),
      ),
    ),
  ];
  const aggregateNames = [
    ...new Set(
      (clauseText.match(/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/gi) ?? []).map((name) =>
        name.replace(/\s*\($/, '').toUpperCase(),
      ),
    ),
  ];

  if (query.groupBy.length > 0) {
    parts.push(
      `按 ${query.groupBy.join('、')} 分组${
        aggregateNames.length > 0 ? `汇总 ${aggregateNames.join('、')}` : ''
      }`,
    );
  } else if (aggregateNames.length > 0 && windowNames.length === 0) {
    parts.push(`汇总 ${aggregateNames.join('、')}`);
  }

  if (windowNames.length > 0) {
    parts.push(`用 ${windowNames.join('、')} 窗口计算`);
  }

  if (query.hasHaving) parts.push('分组后再筛');

  const outputNames = query.outputNames.filter((name) => name !== '*');
  if (outputNames.length > 0) {
    const visible = outputNames.slice(0, 4).join('、');
    const suffix = outputNames.length > 4 ? '…' : '';
    parts.push(`输出 ${query.outputCount} 列（${visible}${suffix}）`);
  } else if (query.outputNames.includes('*')) {
    parts.push('输出全部字段');
  } else if (query.outputCount > 0) {
    parts.push(`输出 ${query.outputCount} 列`);
  }

  if (query.orderBy.length > 0) parts.push(`按 ${query.orderBy.join('、')} 排序`);
  if (query.limit) parts.push(`取前 ${query.limit} 行`);

  return parts.join('，');
}

export function summarizeSemantic(query: SemanticQuery): string {
  const parts: string[] = [];
  let cteSummary: string | null = null;

  if (query.ctes.length > 0) {
    const byName = new Map(
      query.ctes.map((cte) => [cte.name.toLowerCase(), cte]),
    );
    const list = query.ctes.map((cte) => {
      const directRefs = cte.query.sources
        .filter((source) => source.kind === 'cte')
        .map((source) => source.name);
      const tables = collectPhysicalTables(
        cte.query,
        byName,
        new Set([cte.name.toLowerCase()]),
      );
      const suffix =
        directRefs.length > 0 ? `（经 ${directRefs.join(' → ')}）` : '';
      const purpose = cte.description ? `：${cte.description}` : '';
      return `${cte.name} ← ${tables.join('/') || '子查询'}${suffix}${purpose}`;
    });
    cteSummary = `先定义 ${query.ctes.length} 个 CTE：\n${list.join('\n')}`;
  }

  if (query.branches.length > 0) {
    const names = [
      ...new Set(
        [...query.sources, ...query.branches.flatMap((branch) => branch.sources)].map(
          (source) => sourceLabel(source),
        ),
      ),
    ];
    parts.push(`共 ${query.branches.length + 1} 个 UNION 分支`);
    if (names.length > 0) parts.push(`涉及 ${names.join('、')}`);
  } else {
    const [main, ...related] = query.sources;
    if (main) {
      parts.push(`从 ${sourceLabel(main)} 取数`);
    }
    if (related.length > 0) {
      parts.push(`关联 ${related.map(sourceLabel).join('、')}`);
    }
  }
  if (query.whereCount > 0) {
    parts.push(`只看 ${query.whereCount} 个条件`);
  }
  if (query.groupBy.length > 0) {
    parts.push(`按 ${query.groupBy.join('、')} 分组`);
  }
  if (query.hasHaving) {
    parts.push('分组后再筛');
  }
  if (query.outputCount > 0) {
    const outputNames = query.outputNames.filter((name) => name !== '*');
    if (outputNames.length > 0) {
      const visible = outputNames.slice(0, 5).join('、');
      const suffix = outputNames.length > 5 ? '…' : '';
      parts.push(`输出 ${query.outputCount} 列：${visible}${suffix}`);
    } else if (query.outputNames.includes('*')) {
      parts.push('输出全部字段');
    } else {
      parts.push(`输出 ${query.outputCount} 列`);
    }
  }
  if (query.orderBy.length > 0) {
    parts.push(`按 ${query.orderBy.join('、')}`);
  }
  if (query.limit) {
    parts.push(`取前 ${query.limit} 行`);
  }

  const details = parts.length > 0 ? `${parts.join('，')}。` : '';
  const text = [cteSummary, details].filter(Boolean).join('\n');
  return text || '没有识别出可解释的子句。';
}
