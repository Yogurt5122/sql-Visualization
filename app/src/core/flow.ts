import type { Clause, Relations, Statement } from './types';
import { splitTopLevel, stripLeadingKeyword } from './sql-text';

export type FlowStageKind =
  | 'source'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'window'
  | 'select'
  | 'distinct'
  | 'union'
  | 'orderBy'
  | 'limit';

export type FlowEffect =
  | 'source'
  | 'filter'
  | 'aggregate'
  | 'compute'
  | 'distinct'
  | 'union'
  | 'sort'
  | 'truncate';

export interface FlowStep {
  id: string;
  kind: FlowStageKind;
  /** SQL 关键字，例如 FROM / JOIN */
  label: string;
  /** 中文动作，例如 取数 */
  title: string;
  /** 一句话细节，例如 2 张表 · 1 个连接 */
  detail: string;
  effect: FlowEffect;
  startLine: number;
  endLine: number;
  clauseIds: string[];
  /** UNION 分支序号；主查询为空 */
  branch?: number;
}

function makeStep(
  statement: Statement,
  kind: FlowStageKind,
  label: string,
  title: string,
  detail: string,
  effect: FlowEffect,
  clauses: Clause[],
  branch?: number,
): FlowStep {
  const startLine = Math.min(...clauses.map((clause) => clause.span.startLine));
  const endLine = Math.max(...clauses.map((clause) => clause.span.endLine));
  return {
    id: `${statement.id}-${kind}${branch ? `-branch-${branch}` : ''}`,
    kind,
    label,
    title,
    detail,
    effect,
    startLine,
    endLine,
    clauseIds: clauses.map((clause) => clause.id),
    ...(branch ? { branch } : {}),
  };
}

function countItems(text: string): number {
  return splitTopLevel(text, ',').length;
}

function compactSql(text: string, max = 80): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function joinConditionText(text: string): string | undefined {
  const on = /\bON\b([\s\S]+)$/i.exec(text)?.[1];
  if (on) return compactSql(on);
  const using = /\bUSING\s*\(([^)]+)\)/i.exec(text)?.[1];
  if (using) return `USING (${compactSql(using)})`;
  return undefined;
}

function sourceNamesFromClause(from: Clause): string[] {
  const body = stripLeadingKeyword(from.text, 'FROM');
  return splitTopLevel(body, ',')
    .map((part) => {
      const clean = part.trim();
      if (clean.startsWith('(')) return '子查询';
      const match = /^([`"\[][^`"\]]+[`"\]]|[\w$#.]+)/.exec(clean);
      return match?.[1]?.replace(/[`"\[\]]/g, '') ?? '';
    })
    .filter(Boolean);
}

function buildSegment(
  statement: Statement,
  relations?: Relations,
  includeTail = true,
  useRelations = true,
): FlowStep[] {
  const steps: FlowStep[] = [];
  const find = (kind: Clause['kind']): Clause | undefined =>
    statement.clauses.find((clause) => clause.kind === kind);

  const from = find('from');
  const joins = statement.clauses.filter((clause) => clause.kind === 'join');
  const where = find('where');
  const groupBy = find('groupBy');
  const having = find('having');
  const select = find('select');
  const orderBy = find('orderBy');
  const limit = find('limit');

  if (from) {
    const sourceCount = countItems(stripLeadingKeyword(from.text, 'FROM')) + joins.length;
    const tableNames = useRelations
      ? [...new Set((relations?.sources ?? []).map((source) => source.name))]
      : sourceNamesFromClause(from);
    const conditions = joins
      .map((clause) => joinConditionText(clause.text))
      .filter((condition): condition is string => Boolean(condition));
    const detail =
      tableNames.length > 0
        ? `${tableNames.slice(0, 4).join('、')}${tableNames.length > 4 ? '…' : ''}${
            joins.length > 0 ? ` · ${joins.length} 个连接` : ''
          }${conditions.length > 0 ? ` · ${conditions[0]}` : joins.length > 0 ? ' · 缺连接条件' : ''}`
        : joins.length > 0
          ? `${sourceCount} 张表 · ${joins.length} 个连接`
          : `${sourceCount} 张表`;
    steps.push(
      makeStep(statement, 'source', 'FROM / JOIN', '读取表', detail, 'source', [from, ...joins]),
    );
  } else if (joins.length > 0) {
    steps.push(
      makeStep(statement, 'source', 'JOIN', '读取表', `${joins.length} 个连接`, 'source', joins),
    );
  }

  if (where) {
    const condition = compactSql(stripLeadingKeyword(where.text, 'WHERE'));
    steps.push(
      makeStep(
        statement,
        'where',
        'WHERE',
        '过滤',
        condition ? `过滤 ${condition}` : '只保留满足条件的行',
        'filter',
        [where],
      ),
    );
  }

  if (groupBy) {
    const items = splitTopLevel(stripLeadingKeyword(groupBy.text, 'GROUP BY'), ',');
    steps.push(
      makeStep(
        statement,
        'groupBy',
        'GROUP BY',
        '聚合',
        `按 ${items.slice(0, 4).join('、')}${items.length > 4 ? '…' : ''} 分组`,
        'aggregate',
        [groupBy],
      ),
    );
  }

  if (having) {
    const condition = compactSql(stripLeadingKeyword(having.text, 'HAVING'));
    steps.push(
      makeStep(
        statement,
        'having',
        'HAVING',
        '过滤',
        condition ? `过滤聚合 ${condition}` : '分组后再筛一遍',
        'filter',
        [having],
      ),
    );
  }

  if (select) {
    const body = stripLeadingKeyword(select.text, 'SELECT');
    const hasWindow = /\bOVER\s*\(/i.test(body);
    const hasDistinct = /^DISTINCT\b/i.test(body);
    const columnCount = countItems(body.replace(/^DISTINCT\s+/i, ''));
    const outputNames = (relations?.lineage ?? [])
      .map((row) => row.output)
      .filter((name) => Boolean(name));

    const hasStar = outputNames.some(
      (name) => name === '*' || /\.\*$/.test(name),
    );
    const selectDetail = hasStar
      ? '输出全部字段（具体列取决于表结构）'
      : outputNames.length > 0
        ? `输出 ${outputNames.length} 列：${outputNames.slice(0, 4).join('、')}${
            outputNames.length > 4 ? '…' : ''
          }`
        : `输出 ${columnCount} 列`;

    if (hasWindow) {
      steps.push(
        makeStep(statement, 'window', 'WINDOW', '窗口计算', '在结果集上算窗口函数', 'compute', [
          select,
        ]),
      );
    }

    steps.push(
      makeStep(statement, 'select', 'SELECT', '输出字段', selectDetail, 'compute', [select]),
    );

    if (hasDistinct) {
      steps.push(
        makeStep(statement, 'distinct', 'DISTINCT', '去重', '对结果去重', 'distinct', [select]),
      );
    }
  }

  if (includeTail && orderBy) {
    const items = splitTopLevel(stripLeadingKeyword(orderBy.text, 'ORDER BY'), ',');
    steps.push(
      makeStep(
        statement,
        'orderBy',
        'ORDER BY',
        '排序',
        `按 ${items.slice(0, 4).join('、')}${items.length > 4 ? '…' : ''}`,
        'sort',
        [orderBy],
      ),
    );
  }

  if (includeTail && limit) {
    const value = /\d+/.exec(limit.text)?.[0] ?? '若干';
    steps.push(
      makeStep(statement, 'limit', 'LIMIT', '截断', `只取前 ${value} 行`, 'truncate', [limit]),
    );
  }

  return steps;
}

interface UnionSegments {
  main: Clause[];
  branches: Clause[][];
  unions: Clause[];
}

function splitUnionSegments(statement: Statement): UnionSegments {
  const segments: Clause[][] = [[]];
  const unions: Clause[] = [];

  for (const clause of statement.clauses) {
    if (clause.kind === 'union') {
      unions.push(clause);
      segments.push([]);
      continue;
    }
    segments[segments.length - 1]!.push(clause);
  }

  return {
    main: segments[0]!,
    branches: segments.slice(1),
    unions,
  };
}

/**
 * 以数据库的**逻辑求值顺序**生成执行流程，而不是 SQL 的书写顺序。
 *
 * 主查询 → 各 UNION 分支 → UNION 合并 → 全局 ORDER BY / LIMIT
 */
export function buildFlow(
  statement: Statement,
  relations?: Relations,
): FlowStep[] {
  const { main, branches, unions } = splitUnionSegments(statement);
  const isUnion = unions.length > 0;
  const steps: FlowStep[] = [];

  steps.push(
    ...buildSegment(
      { ...statement, clauses: main },
      relations,
      !isUnion,
      !isUnion,
    ),
  );

  branches.forEach((clauses, index) => {
    const branch = index + 1;
    const branchStatement: Statement = {
      ...statement,
      id: `${statement.id}-branch-${branch}`,
      clauses,
    };
    steps.push(
      ...buildSegment(branchStatement, undefined, false, false).map((step) => ({
        ...step,
        branch,
      })),
    );
  });

  if (isUnion) {
    steps.push(
      ...buildSegment(
        {
          ...statement,
          id: `${statement.id}-union`,
          clauses: unions,
        },
        undefined,
        false,
      ),
    );

    const all = unions.some((clause) => /\bUNION\s+ALL\b/i.test(clause.text));
    const label = all ? 'UNION ALL' : 'UNION';
    steps.push({
      id: `${statement.id}-union-merge`,
      kind: 'union',
      label,
      title: '合并结果',
      detail: all
        ? `合并 ${branches.length + 1} 个分支，保留重复行`
        : `合并 ${branches.length + 1} 个分支并去重`,
      effect: 'union',
      startLine: Math.min(...unions.map((clause) => clause.span.startLine)),
      endLine: Math.max(...unions.map((clause) => clause.span.endLine)),
      clauseIds: unions.map((clause) => clause.id),
    });

    const tailClauses = statement.clauses.filter(
      (clause) => clause.kind === 'orderBy' || clause.kind === 'limit',
    );
    if (tailClauses.length > 0) {
      steps.push(
        ...buildSegment(
          {
            ...statement,
            id: `${statement.id}-tail`,
            clauses: tailClauses,
          },
          undefined,
          true,
        ),
      );
    }
  }

  return steps;
}
