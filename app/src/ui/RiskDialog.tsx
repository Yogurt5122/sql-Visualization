import { useEffect } from 'react';
import type { Issue } from '../core/types';

export interface RiskDialogProps {
  issues: Issue[];
  highRiskCount: number;
  statementCount: number;
  onClose: () => void;
  onSelectIssue: (issue: Issue) => void;
  statementLocation: (issue: Issue) => string;
}

export function RiskDialog({
  issues,
  highRiskCount,
  statementCount,
  onClose,
  onSelectIssue,
  statementLocation,
}: RiskDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="risk-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="risk-dialog" role="dialog" aria-modal="true" aria-labelledby="risk-title">
        <header className="risk-dialog-head">
          <div>
            <h2 id="risk-title">
              风险体检
              {statementCount > 1 ? <span className="risk-scope">全文</span> : null}
            </h2>
            <p>
              {issues.length} 条检查结果
              {highRiskCount > 0 ? ` · 高 ${highRiskCount}` : ''}
            </p>
          </div>
          <button type="button" className="risk-dialog-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <ul className="risk-dialog-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className="issue-button"
                onClick={() => onSelectIssue(issue)}
              >
                <span className={`severity-dot severity-${issue.severity}`} aria-hidden="true" />
                <span className="issue-main">
                  <span className="issue-title">
                    <code>{issue.ruleId}</code> {issue.title}
                    {issue.confidence === 'low' ? (
                      <span className="issue-heuristic">启发式</span>
                    ) : null}
                  </span>
                  <span className="issue-location">
                    {issue.span ? `第 ${issue.span.startLine} 行` : statementLocation(issue)}
                  </span>
                  <span className="issue-detail">{issue.detail}</span>
                  {issue.suggestion ? (
                    <span className="issue-suggestion">建议：{issue.suggestion}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="risk-dialog-foot">静态代码检查，不是执行计划，也不代表一定会慢。</p>
      </section>
    </div>
  );
}
