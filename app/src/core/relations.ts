import type {
  AnalysisMetrics,
  JoinType,
  LineageRow,
  LineageTransform,
  RelationJoin,
  RelationSource,
  Relations,
  SemanticQuery,
  Statement,
} from './types';
import { scan } from './scanner';
import { splitTopLevel, stripLeadingKeyword } from './sql-text';

const RESERVED_ALIAS = new Set([
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'CROSS',
  'NATURAL',
  'JOIN',
  'ON',
  'WHERE',
  'GROUP',
  'ORDER',
  'LIMIT',
  'USING',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'NULL',
  'TRUE',
  'FALSE',
  'DISTINCT',
  'ALL',
]);

interface ParsedSource {
  name: string;
  alias?: string;
  kind: 'table' | 'subquery';
}

interface PendingJoin {
  source: RelationSource;
  type: JoinType;
  condition?: string;
  line: number;
}

function parseSourcePart(part: string): ParsedSource | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('(')) {
    const alias = /\)\s+(?:AS\s+)?([A-Za-z_]\w*)/.exec(trimmed)?.[1];
    return { name: '子查询', alias, kind: 'subquery' };
  }

  const match =
    /^([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/.exec(
      trimmed,
    );
  if (!match) return null;

  const alias =
    match[2] && !RESERVED_ALIAS.has(match[2].toUpperCase()) ? match[2] : undefined;
  return { name: match[1]!, alias, kind: 'table' };
}

function afterKeyword(text: string, keyword: string): string | null {
  const match = new RegExp(`\\b${keyword}\\b`, 'i').exec(text);
  if (!match) return null;
  return text.slice(match.index + match[0].length).trim();
}

function compact(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function detectTransform(expression: string): LineageTransform {
  const value = expression.trim();
  if (!value) return 'unknown';
  if (/^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(value)) return 'aggregate';
  if (/\bOVER\s*\(/i.test(value)) return 'window';
  if (/^CASE\b/i.test(value)) return 'case';
  if (/^(CAST|CONVERT)\s*\(/i.test(value) || /::/.test(value)) return 'cast';
  if (/^[\w$."`\[\]]+$/.test(value)) return 'direct';
  if (/^['"]|^-?\d/.test(value)) return 'literal';
  if (/[A-Za-z_]\w*\s*\(/.test(value)) return 'function';
  return 'unknown';
}

function buildLineage(statement: Statement, sources: RelationSource[]): LineageRow[] {
  const select = statement.clauses.find((clause) => clause.kind === 'select');
  if (!select) return [];

  const body = stripLeadingKeyword(select.text, 'SELECT').replace(/^DISTINCT\s+/i, '');
  const items = splitTopLevel(body, ',');
  const byAlias = new Map<string, RelationSource>();
  for (const source of sources) {
    if (source.alias) byAlias.set(source.alias.toLowerCase(), source);
    byAlias.set(source.name.toLowerCase(), source);
  }

  return items.map((item, index) => {
    const asMatch = /\s+AS\s+([A-Za-z_]\w*)\s*$/i.exec(item);
    let alias = asMatch?.[1];
    let expression = asMatch
      ? item.slice(0, asMatch.index).trim()
      : item.trim();

    if (!alias) {
      const trailing = /\s+([A-Za-z_]\w*)\s*$/.exec(item);
      if (trailing && !RESERVED_ALIAS.has(trailing[1]!.toUpperCase())) {
        const before = item.slice(0, trailing.index).trim();
        if (/\)$/.test(before) || /^[A-Za-z_][\w$."`\[\]]*$/.test(before)) {
          alias = trailing[1];
          expression = before;
        }
      }
    }

    const output = alias ?? compact(expression, 28);

    if (expression === '*' || /^[A-Za-z_]\w*\.\*$/.test(expression)) {
      const starSources = [
        ...new Set(sources.map((source) => source.name).filter(Boolean)),
      ];
      return {
        id: `${statement.id}-lineage-${index + 1}`,
        output,
        source:
          starSources.length > 0
            ? starSources.map((name) => `${name}.*`).join(' / ')
            : '全部字段',
        transform: 'unknown',
        line: select.span.startLine,
        confidence: 'unknown',
      };
    }

    const refs = [...expression.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g)];
    const resolved: string[] = [];
    let confidence: LineageRow['confidence'] = 'exact';

    for (const ref of refs) {
      const left = ref[1]!;
      const column = ref[2]!;
      const source = byAlias.get(left.toLowerCase());
      if (source) {
        resolved.push(`${source.name}.${column}`);
      } else {
        resolved.push(`${left}.${column}`);
        confidence = 'partial';
      }
    }

    if (resolved.length === 0) {
      if (/^COUNT\s*\(\s*\*\s*\)$/i.test(expression)) {
        resolved.push('按行计数');
      } else if (/^['"]|^-?\d/.test(expression)) {
        resolved.push('常量');
      } else {
        resolved.push('表达式');
        confidence = 'unknown';
      }
    }

    return {
      id: `${statement.id}-lineage-${index + 1}`,
      output,
      source: resolved.join(' + '),
      transform: detectTransform(expression),
      line: select.span.startLine,
      confidence,
    };
  });
}

export function buildRelations(statement: Statement): Relations {
  const sources: RelationSource[] = [];
  const byKey = new Map<string, RelationSource>();
  const pendingJoins: PendingJoin[] = [];

  const cteNames = new Set<string>();
  for (const clause of statement.clauses) {
    if (clause.kind !== 'with') continue;
    for (const match of clause.text.matchAll(/\b([A-Za-z_]\w*)\s+AS\s*\(/gi)) {
      cteNames.add(match[1]!.toLowerCase());
    }
  }

  const addSource = (
    name: string,
    alias: string | undefined,
    kind: 'table' | 'cte' | 'subquery',
    line: number,
  ): RelationSource => {
    const key = (alias ?? name).toLowerCase();
    const existing = byKey.get(key);
    if (existing) return existing;

    const source: RelationSource = {
      id: `${statement.id}-src-${sources.length + 1}`,
      name,
      alias,
      kind: kind === 'table' && cteNames.has(name.toLowerCase()) ? 'cte' : kind,
      line,
    };
    sources.push(source);
    byKey.set(key, source);
    if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), source);
    return source;
  };

  let fromSourceCount = 0;
  let fromClause: Statement['clauses'][number] | undefined;

  for (const clause of statement.clauses) {
    if (clause.kind !== 'from') continue;
    fromClause = clause;
    const parts = splitTopLevel(stripLeadingKeyword(clause.text, 'FROM'), ',');
    fromSourceCount = parts.length;
    for (const part of parts) {
      const parsed = parseSourcePart(part);
      if (parsed) addSource(parsed.name, parsed.alias, parsed.kind, clause.span.startLine);
    }
  }

  for (const clause of statement.clauses) {
    if (clause.kind !== 'join') continue;

    const match =
      /^\s*(?:(LEFT|RIGHT|FULL|INNER|CROSS|NATURAL)\s+(?:OUTER\s+)?)?JOIN\s+([A-Za-z_][\w$."`[\]]*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/i.exec(
        clause.text,
      );
    if (!match) continue;

    const table = match[2]!;
    const alias =
      match[3] && !RESERVED_ALIAS.has(match[3].toUpperCase()) ? match[3] : undefined;
    const source = addSource(table, alias, 'table', clause.span.startLine);

    const on = afterKeyword(clause.text, 'ON');
    const using = afterKeyword(clause.text, 'USING');
    const condition = on ?? (using ? `USING (${using})` : undefined);

    // JOIN 子句后面还可能跟逗号表，例如：
    // JOIN b ON b.id = a.id, c
    const tail = on ?? using ?? afterKeyword(clause.text, 'JOIN');
    if (tail) {
      for (const extra of splitTopLevel(tail, ',').slice(1)) {
        const parsed = parseSourcePart(extra);
        if (parsed) {
          addSource(parsed.name, parsed.alias, parsed.kind, clause.span.startLine);
        }
      }
    }

    const prefix = match[1]?.toUpperCase();
    const type: JoinType = prefix
      ? prefix === 'LEFT'
        ? 'left'
        : prefix === 'RIGHT'
          ? 'right'
          : prefix === 'FULL'
            ? 'full'
            : prefix === 'CROSS'
              ? 'cross'
              : 'inner'
      : condition
        ? 'inner'
        : 'cross';

    pendingJoins.push({ source, type, condition, line: clause.span.startLine });
  }

  const joins: RelationJoin[] = [];
  const main = sources[0];

  if (main) {
    for (const pending of pendingJoins) {
      if (pending.source.id === main.id) continue;
      joins.push({
        id: `${statement.id}-join-${joins.length + 1}`,
        from: main.id,
        to: pending.source.id,
        type: pending.type,
        condition: pending.condition,
        line: pending.line,
      });
    }
  }

  // DM8 / Oracle 的 (+) 外连接：带 (+) 的一侧是可空侧，另一侧是保留侧
  for (const clause of statement.clauses) {
    if (clause.kind !== 'where') continue;
    const patterns = [
      /([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(\+\)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g,
      /([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(\+\)/g,
    ];

    patterns.forEach((pattern, patternIndex) => {
      for (const match of clause.text.matchAll(pattern)) {
        const nullableAlias = patternIndex === 0 ? match[1]! : match[3]!;
        const preservedAlias = patternIndex === 0 ? match[3]! : match[1]!;
        const nullable = byKey.get(nullableAlias.toLowerCase());
        const preserved = byKey.get(preservedAlias.toLowerCase());
        if (!nullable || !preserved) continue;
        if (
          joins.some(
            (join) => join.from === preserved.id && join.to === nullable.id,
          )
        ) {
          continue;
        }
        joins.push({
          id: `${statement.id}-join-${joins.length + 1}`,
          from: preserved.id,
          to: nullable.id,
          type: 'left',
          condition: compact(match[0], 60),
          line: clause.span.startLine,
        });
      }
    });
  }

  // 逗号连接没有显式 JOIN，补一条虚线关系，避免图上两张表“悬空”
  if (main && fromSourceCount > 1 && joins.length === 0) {
    for (const source of sources.slice(1)) {
      joins.push({
        id: `${statement.id}-join-${joins.length + 1}`,
        from: main.id,
        to: source.id,
        type: 'unknown',
        condition: '逗号连接（条件在 WHERE）',
        line: fromClause?.span.startLine ?? statement.span.startLine,
      });
    }
  }

  return {
    sources,
    joins,
    lineage: buildLineage(statement, sources),
  };
}

function collectSemanticTables(query: SemanticQuery, result: Set<string>): void {
  for (const table of query.tables) result.add(table.toLowerCase());
  for (const cte of query.ctes) collectSemanticTables(cte.query, result);
  for (const subquery of query.subqueries) collectSemanticTables(subquery, result);
  for (const branch of query.branches) collectSemanticTables(branch, result);
}

function semanticDepth(query: SemanticQuery): number {
  let depth = query.depth;
  for (const cte of query.ctes) depth = Math.max(depth, semanticDepth(cte.query));
  for (const subquery of query.subqueries) {
    depth = Math.max(depth, semanticDepth(subquery));
  }
  for (const branch of query.branches) {
    depth = Math.max(depth, semanticDepth(branch));
  }
  return depth;
}

export function buildMetrics(
  statement: Statement,
  relations: Relations,
  semantic?: SemanticQuery,
): AnalysisMetrics {
  const text = statement.text;
  const { tokens } = scan(text);
  const scanDepth = tokens.reduce((max, token) => {
    if (
      token.kind === 'keyword' &&
      token.text.toUpperCase() === 'SELECT' &&
      token.depth > 0
    ) {
      return Math.max(max, token.depth);
    }
    return max;
  }, 0);
  const depth = semantic ? semanticDepth(semantic) : scanDepth;
  const ctes = new Set(
    relations.sources.filter((source) => source.kind === 'cte').map((source) => source.name),
  ).size;
  const semanticTables = new Set<string>();
  if (semantic) collectSemanticTables(semantic, semanticTables);
  const tables =
    semanticTables.size > 0
      ? semanticTables.size
      : new Set(
          relations.sources
            .filter((source) => source.kind === 'table')
            .map((source) => source.name.toLowerCase()),
        ).size;
  const unions = (text.match(/\b(UNION|INTERSECT|EXCEPT|MINUS)\b/gi) ?? []).length;
  const cases = (text.match(/\bCASE\b/gi) ?? []).length;
  const windows = (text.match(/\bOVER\s*\(/gi) ?? []).length;
  const subqueries = (text.match(/\(\s*SELECT\b/gi) ?? []).length;
  const distinct = /\bSELECT\s+DISTINCT\b/i.test(text) ? 1 : 0;

  const complexity = Math.min(
    100,
    Math.round(
      8 * relations.joins.length +
        10 * depth +
        5 * ctes +
        6 * unions +
        3 * cases +
        3 * windows +
        2 * subqueries +
        distinct,
    ),
  );

  return {
    tables,
    joins: relations.joins.length,
    outputs: relations.lineage.length,
    depth,
    complexity,
  };
}

export function mergeMetrics(list: AnalysisMetrics[]): AnalysisMetrics {
  if (list.length === 0) {
    return { tables: 0, joins: 0, outputs: 0, depth: 0, complexity: 0 };
  }
  return {
    tables: list.reduce((sum, item) => sum + item.tables, 0),
    joins: list.reduce((sum, item) => sum + item.joins, 0),
    outputs: list.reduce((sum, item) => sum + item.outputs, 0),
    depth: Math.max(...list.map((item) => item.depth)),
    complexity: Math.max(...list.map((item) => item.complexity)),
  };
}
