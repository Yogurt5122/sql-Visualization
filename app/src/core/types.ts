export type Dialect = 'auto' | 'mysql' | 'tsql' | 'postgres' | 'dm8';
export type ResolvedDialect = Exclude<Dialect, 'auto'>;

export type TokenKind =
  | 'keyword'
  | 'ident'
  | 'quotedIdent'
  | 'string'
  | 'number'
  | 'operator'
  | 'punct'
  | 'comment'
  | 'param'
  | 'other';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  line: number;
  col: number;
  depth: number;
}

export interface Span {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
}

export type ClauseKind =
  | 'with'
  | 'select'
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'orderBy'
  | 'limit'
  | 'offset'
  | 'union'
  | 'insert'
  | 'update'
  | 'delete'
  | 'other';

export interface Clause {
  id: string;
  kind: ClauseKind;
  label: string;
  span: Span;
  text: string;
}

export type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

export interface Statement {
  id: string;
  index: number;
  kind: StatementKind;
  span: Span;
  text: string;
  clauses: Clause[];
}

export interface Explanation {
  clauseId: string;
  plain: string;
  technical: string;
  refs: string[];
}

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface Issue {
  id: string;
  ruleId: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  clauseId?: string;
  span?: Span;
}

export interface Analysis {
  dialect: ResolvedDialect;
  confidence: number;
  statements: Statement[];
  explanations: Explanation[];
  issues: Issue[];
  summary: string;
  warnings: string[];
  mode: 'structural';
}

export interface ScanError {
  message: string;
  offset: number;
  line: number;
  col: number;
}
