import type { Clause, SemanticQuery, Statement } from './types';
import { splitTopLevel, stripLeadingKeyword } from './sql-text';

export type StructureKind = 'statement' | 'query' | 'clause' | 'subquery' | 'cte';

export interface StructureNode {
  id: string;
  kind: StructureKind;
  label: string;
  badge: string;
  startLine: number;
  endLine: number;
  searchText: string;
  hasTable: boolean;
  children: StructureNode[];
}

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
]);

const STATEMENT_LABEL: Record<Statement['kind'], string> = {
  select: '查询',
  insert: '插入',
  update: '更新',
  delete: '删除',
  other: '其他',
};

function lineAt(baseLine: number, text: string, offset: number): number {
  let line = baseLine;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function addTableRef(refs: Set<string>, part: string): void {
  const match =
    /^\s*([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/.exec(part);
  if (!match) return;

  const table = match[1]!;
  refs.add(table);
  if (table.includes('.')) refs.add(table.split('.').pop()!);

  const alias = match[2];
  if (alias && !RESERVED_ALIAS.has(alias.toUpperCase())) refs.add(alias);
}

function extractTableRefs(statement: Statement): string[] {
  const refs = new Set<string>();

  for (const clause of statement.clauses) {
    if (clause.kind === 'from') {
      const body = stripLeadingKeyword(clause.text, 'FROM');
      for (const part of splitTopLevel(body, ',')) addTableRef(refs, part);
    } else if (clause.kind === 'join') {
      const match =
        /JOIN\s+([A-Za-z_][\w$."`\[\]]*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/i.exec(clause.text);
      if (!match) continue;
      refs.add(match[1]!);
      const alias = match[2];
      if (alias && !RESERVED_ALIAS.has(alias.toUpperCase())) refs.add(alias);
    }
  }

  return [...refs];
}

function textHasRef(text: string, refs: string[]): boolean {
  return refs.some((ref) => {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

function semanticClauseNodes(query: SemanticQuery): StructureNode[] {
  return query.clauses.map((clause, index) => ({
    id: `${query.id}-clause-${index + 1}`,
    kind: 'clause',
    label: clause.label,
    badge: '子句',
    startLine: clause.startLine,
    endLine: clause.endLine,
    searchText: clause.text,
    hasTable: clause.hasTable,
    children: [],
  }));
}

function buildSubqueries(
  clause: Clause,
  refs: string[],
  counter: { count: number },
  semantic?: SemanticQuery,
): StructureNode[] {
  const nodes: StructureNode[] = [];
  const pattern = /\(\s*SELECT\b/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(clause.text))) {
    const open = match.index;
    const close = findClosingParen(clause.text, open);
    if (close < 0) break;

    const text = clause.text.slice(open, close + 1);
    counter.count += 1;
    const inner = semantic?.subqueries[counter.count - 1];

    nodes.push({
      id: `${clause.id}-sub-${counter.count}`,
      kind: 'subquery',
      label: `#${counter.count}`,
      badge: '子查询',
      startLine: lineAt(clause.span.startLine, clause.text, open),
      endLine: lineAt(clause.span.startLine, clause.text, close + 1),
      searchText: text,
      hasTable: textHasRef(text, refs),
      children: inner ? semanticClauseNodes(inner) : [],
    });

    pattern.lastIndex = close + 1;
  }

  return nodes;
}

function buildCtes(
  clause: Clause,
  refs: string[],
  semantic?: SemanticQuery,
): StructureNode[] {
  const nodes: StructureNode[] = [];
  const pattern = /\b([A-Za-z_]\w*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(clause.text))) {
    const open = match.index + match[0].length - 1;
    const close = findClosingParen(clause.text, open);
    if (close < 0) continue;

    const name = match[1]!;
    const text = clause.text.slice(open, close + 1);
    index += 1;
    const inner = semantic?.ctes.find(
      (cte) => cte.name.toLowerCase() === name.toLowerCase(),
    );

    nodes.push({
      id: `${clause.id}-cte-${index}-${name.toLowerCase()}`,
      kind: 'cte',
      label: name,
      badge: 'CTE',
      startLine: lineAt(clause.span.startLine, clause.text, match.index),
      endLine: lineAt(clause.span.startLine, clause.text, close + 1),
      searchText: `${name} ${text}`,
      hasTable: textHasRef(text, refs),
      children: inner ? semanticClauseNodes(inner.query) : [],
    });

    pattern.lastIndex = close + 1;
  }

  return nodes;
}

function buildClauseNode(
  clause: Clause,
  refs: string[],
  counter: { count: number },
  semantic?: SemanticQuery,
): StructureNode {
  const canContainSubquery =
    clause.kind === 'from' ||
    clause.kind === 'join' ||
    clause.kind === 'where' ||
    clause.kind === 'having' ||
    clause.kind === 'select';

  const children = canContainSubquery
    ? buildSubqueries(clause, refs, counter, semantic)
    : [];

  return {
    id: clause.id,
    kind: 'clause',
    label: clause.label,
    badge: '子句',
    startLine: clause.span.startLine,
    endLine: clause.span.endLine,
    searchText: clause.text,
    hasTable: textHasRef(clause.text, refs) || children.some((child) => child.hasTable),
    children,
  };
}

export function buildStructure(
  statement: Statement,
  semantic?: SemanticQuery,
): StructureNode {
  const refs = extractTableRefs(statement);
  const counter = { count: 0 };
  const clauses = [...statement.clauses].sort(
    (a, b) => a.span.startLine - b.span.startLine || a.span.start - b.span.start,
  );
  const withClause = clauses.find((clause) => clause.kind === 'with');
  const mainClauses = clauses.filter((clause) => clause.kind !== 'with');

  const root: StructureNode = {
    id: statement.id,
    kind: 'statement',
    label: `#${statement.index + 1} · ${STATEMENT_LABEL[statement.kind]}`,
    badge: '语句',
    startLine: statement.span.startLine,
    endLine: statement.span.endLine,
    searchText: statement.text,
    hasTable: false,
    children: [],
  };

  if (withClause) {
    const ctes = buildCtes(withClause, refs, semantic);
    root.children.push({
      id: withClause.id,
      kind: 'clause',
      label: 'WITH',
      badge: '子句',
      startLine: withClause.span.startLine,
      endLine: withClause.span.endLine,
      searchText: withClause.text,
      hasTable: textHasRef(withClause.text, refs) || ctes.some((cte) => cte.hasTable),
      children: ctes,
    });
  }

  const queryStart = mainClauses.length
    ? Math.min(...mainClauses.map((clause) => clause.span.startLine))
    : statement.span.startLine;
  const queryEnd = mainClauses.length
    ? Math.max(...mainClauses.map((clause) => clause.span.endLine))
    : statement.span.endLine;

  const query: StructureNode = {
    id: `${statement.id}-query`,
    kind: 'query',
    label: '主查询',
    badge: '查询块',
    startLine: queryStart,
    endLine: queryEnd,
    searchText: '',
    hasTable: false,
    children: mainClauses.map((clause) =>
      buildClauseNode(clause, refs, counter, semantic),
    ),
  };
  query.hasTable = query.children.some((child) => child.hasTable);
  root.children.push(query);
  root.hasTable = root.children.some((child) => child.hasTable);

  return root;
}

/**
 * 搜索 / 只看含表：保留命中的节点及其祖先。
 */
export function filterStructure(
  nodes: StructureNode[],
  query: string,
  onlyTables: boolean,
): StructureNode[] {
  const keyword = query.trim().toLowerCase();
  const result: StructureNode[] = [];

  for (const node of nodes) {
    if (onlyTables && !node.hasTable) continue;

    const children = filterStructure(node.children, query, onlyTables);
    const selfMatch =
      keyword === '' ||
      `${node.label} ${node.searchText}`.toLowerCase().includes(keyword);

    if (selfMatch || children.length > 0) {
      result.push({ ...node, children });
    }
  }

  return result;
}

export function findActiveNode(
  nodes: StructureNode[],
  line: number,
): StructureNode | undefined {
  for (const node of nodes) {
    if (line < node.startLine || line > node.endLine) continue;
    return findActiveNode(node.children, line) ?? node;
  }
  return undefined;
}
