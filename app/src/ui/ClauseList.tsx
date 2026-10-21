import { useMemo } from 'react';
import type { Clause, Explanation, Issue, Statement } from '../core/types';

const STATEMENT_LABEL: Record<Statement['kind'], string> = {
  select: '查询',
  insert: '插入',
  update: '更新',
  delete: '删除',
  other: '其他',
};

export interface ClauseListProps {
  statements: Statement[];
  explanations: Explanation[];
  issues: Issue[];
  activeClauseId?: string;
  onSelect: (clause: Clause) => void;
}

function lineRange(clause: Clause): string {
  return clause.span.startLine === clause.span.endLine
    ? `第 ${clause.span.startLine} 行`
    : `第 ${clause.span.startLine}–${clause.span.endLine} 行`;
}

export function ClauseList({
  statements,
  explanations,
  issues,
  activeClauseId,
  onSelect,
}: ClauseListProps) {
  const explanationById = useMemo(() => {
    const map = new Map<string, Explanation>();
    for (const item of explanations) map.set(item.clauseId, item);
    return map;
  }, [explanations]);

  const issuesByClause = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.clauseId) continue;
      const list = map.get(issue.clauseId) ?? [];
      list.push(issue);
      map.set(issue.clauseId, list);
    }
    return map;
  }, [issues]);

  if (statements.length === 0) {
    return (
      <div className="empty-result">
        <p>把 SQL 粘贴到左边，这里会按子句逐段解释。</p>
        <p className="muted">解析在浏览器本地完成，不会上传，也不会写入存储。</p>
      </div>
    );
  }

  return (
    <div className="clause-list">
      {statements.map((statement) => (
        <section className="statement" key={statement.id}>
          <div className="statement-head">
            <span className="statement-title">
              语句 {statement.index + 1} · {STATEMENT_LABEL[statement.kind]}
            </span>
            <span className="statement-range">
              第 {statement.span.startLine}–{statement.span.endLine} 行
            </span>
          </div>

          {statement.clauses.map((clause) => {
            const explanation = explanationById.get(clause.id);
            const clauseIssues = issuesByClause.get(clause.id) ?? [];
            const active = clause.id === activeClauseId;

            return (
              <article
                key={clause.id}
                className={`clause-card clause-kind-${clause.kind}${active ? ' is-active' : ''}`}
                onClick={() => onSelect(clause)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(clause);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`${clause.label} ${lineRange(clause)}`}
              >
                <header className="clause-head">
                  <span className="clause-label">{clause.label}</span>
                  <span className="clause-range">{lineRange(clause)}</span>
                </header>

                <p className="clause-plain">{explanation?.plain ?? '这一段还没能解释。'}</p>

                {clauseIssues.length > 0 && (
                  <ul className="clause-issues">
                    {clauseIssues.map((issue) => (
                      <li key={issue.id} className={`issue-inline severity-${issue.severity}`}>
                        <span className="severity-dot" aria-hidden="true" />
                        <span>
                          <strong>{issue.ruleId}</strong> {issue.title}
                          {issue.confidence === 'low' ? (
                            <span className="issue-heuristic">启发式</span>
                          ) : null}
                          <span className="issue-inline-detail">{issue.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {explanation && explanation.refs.length > 0 && (
                  <p className="clause-refs">涉及：{explanation.refs.join('、')}</p>
                )}

                {explanation && (
                  <details className="clause-technical">
                    <summary>术语版</summary>
                    <pre>{explanation.technical}</pre>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
