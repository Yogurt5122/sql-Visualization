import { Parser } from 'node-sql-parser';
import type {
  ClauseKind,
  JoinType,
  LineageRow,
  LineageTransform,
  RelationJoin,
  RelationSource,
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

  // CTE 追底层表：只把依赖边放在 dependencies，不计入 joins 指标
  const dependencies: RelationJoin[] = [];
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
    const via: string[] = [];
    let confidence: LineageRow['confidence'] = 'exact';

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
      transform: transformOf(expr),
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

  return { sources, joins, dependencies, lineage };
}

interface ResolvedRef {
  source: string;
  via: string[];
  exact: boolean;
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

function findCteColumn(cteAst: AstNode, column: string): AstNode | undefined {
  const target = column.toLowerCase();
  for (const item of cteAst.columns ?? []) {
    const alias = aliasOf(item.as);
    if (alias && alias.toLowerCase() === target) return item.expr;
    if (item.expr?.type === 'column_ref') {
      const name = String(item.expr.column ?? '');
      if (name.toLowerCase() === target) return item.expr;
    }
  }
  return undefined;
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
      const expr = findCteColumn(cteAst, ref.column);
      if (!expr) return null;
      const nested = resolveExpression(
        cteAst,
        expr,
        cteMap,
        new Set([...visited, key]),
      );
      if (!nested) return null;
      return {
        source: nested.source,
        via: [tableName, ...nested.via],
        exact: nested.exact,
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
  };
}

function resolveColumnInQuery(
  queryAst: AstNode,
  column: string,
  cteMap: Map<string, AstNode>,
  visited: Set<string>,
): ResolvedRef | null {
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
  const operator = String(node.operator ?? '').toUpperCase();
  if (node.type === 'binary_expr' && (operator === 'AND' || operator === 'OR')) {
    return countPredicates(node.left) + countPredicates(node.right);
  }
  return 1;
}

function collectSelectNodes(
  node: unknown,
  result: AstNode[],
  seen: WeakSet<object>,
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectSelectNodes(item, result, seen);
    return;
  }
  if (seen.has(node)) return;
  seen.add(node);

  const value = node as AstNode;
  if (value.type === 'select') {
    result.push(value);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'as') continue;
    collectSelectNodes(child, result, seen);
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
      ctes.push({ name: cteName, tables: query.tables, query });
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

  return {
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
    tables,
    clauses,
    ctes,
    subqueries,
    branches,
  };
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

export function summarizeSemantic(query: SemanticQuery): string {
  const parts: string[] = [];

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
      return `${cte.name} ← ${tables.join('/') || '子查询'}${suffix}`;
    });
    parts.push(`先定义 ${query.ctes.length} 个 CTE（${list.join('、')}）`);
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
    parts.push(`输出 ${query.outputCount} 列`);
  }
  if (query.orderBy.length > 0) {
    parts.push(`按 ${query.orderBy.join('、')}`);
  }
  if (query.limit) {
    parts.push(`取前 ${query.limit} 行`);
  }

  return parts.length > 0 ? `${parts.join('，')}。` : '没有识别出可解释的子句。';
}
