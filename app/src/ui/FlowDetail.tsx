import { useEffect } from 'react';
import type { FlowStep } from '../core/flow';
import type { Explanation, Issue, Relations } from '../core/types';

export interface FlowDetailProps {
  step: FlowStep;
  statementIndex: number;
  statementCount: number;
  relations?: Relations;
  explanations: Explanation[];
  issues: Issue[];
  onClose: () => void;
  onLocate: () => void;
}

const SEVERITY_LABEL: Record<Issue['severity'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export function FlowDetail({
  step,
  statementIndex,
  statementCount,
  relations,
  explanations,
  issues,
  onClose,
  onLocate,
}: FlowDetailProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const clauseExplanations = explanations.filter((explanation) =>
    step.clauseIds.includes(explanation.clauseId),
  );
  const stepIssues = issues.filter(
    (issue) => issue.clauseId && step.clauseIds.includes(issue.clauseId),
  );
  const fields = step.kind === 'select' ? relations?.lineage ?? [] : [];
  const sources =
    step.kind === 'source' || step.kind === 'window'
      ? relations?.sources ?? []
      : [];

  return (
    <div
      className="flow-detail-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`flow-detail-dialog flow-detail-${step.effect}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="flow-detail-title"
      >
        <header className="flow-detail-head">
          <span className={`flow-detail-badge flow-effect-${step.effect}`}>
            {step.label}
          </span>
          <div className="flow-detail-heading">
            <h3 id="flow-detail-title">{step.title}</h3>
            <p>
              {statementCount > 1 ? `语句 ${statementIndex + 1} · ` : ''}
              L{step.startLine}
              {step.endLine !== step.startLine ? `–${step.endLine}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="flow-detail-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <p className="flow-detail-summary">{step.detail}</p>

        {fields.length > 0 ? (
          <div className="flow-detail-block">
            <h4>输出字段</h4>
            <div className="flow-detail-table-wrap">
              <table className="flow-detail-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.output}</code>
                      </td>
                      <td>{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="flow-detail-block">
            <h4>这一步读的表</h4>
            <div className="flow-detail-table-wrap">
              <table className="flow-detail-table">
                <thead>
                  <tr>
                    <th>表 / 数据源</th>
                    <th>类型</th>
                    <th>行</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <code>{source.name}</code>
                        {source.alias ? `（${source.alias}）` : ''}
                      </td>
                      <td>
                        {source.kind === 'cte'
                          ? 'CTE'
                          : source.kind === 'subquery'
                            ? '子查询'
                            : '表'}
                      </td>
                      <td>L{source.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {clauseExplanations.length > 0 ? (
          <div className="flow-detail-block">
            <h4>这一步在做什么</h4>
            {clauseExplanations.map((explanation) => (
              <p key={explanation.clauseId} className="flow-detail-explain">
                {explanation.plain}
              </p>
            ))}
          </div>
        ) : null}

        {stepIssues.length > 0 ? (
          <div className="flow-detail-block">
            <h4>相关风险</h4>
            <ul className="flow-detail-issues">
              {stepIssues.map((issue) => (
                <li key={issue.id}>
                  <strong>{issue.ruleId}</strong>
                  <span className={`flow-detail-severity severity-${issue.severity}`}>
                    {SEVERITY_LABEL[issue.severity]}
                  </span>
                  <span>{issue.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <footer className="flow-detail-foot">
          <button type="button" className="flow-detail-locate" onClick={onLocate}>
            定位原文
          </button>
          <button type="button" className="flow-detail-done" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
