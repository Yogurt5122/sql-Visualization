import { useMemo, useState } from 'react';
import { analyzeSql } from './core/explain';
import { buildFlow, type FlowStep } from './core/flow';
import { DIALECT_LABEL, DIALECT_OPTIONS } from './core/dialects';
import type { Clause, Dialect, Issue } from './core/types';
import { Editor } from './ui/Editor';
import { ClauseList } from './ui/ClauseList';
import { FlowView } from './ui/FlowView';

const SAMPLE_MYSQL = `SELECT o.user_id, COUNT(*) AS cnt
FROM dwd_order o
JOIN dim_user u ON o.user_id = u.id
WHERE o.dt = '2024-01-01' AND u.status = 1
GROUP BY o.user_id
HAVING COUNT(*) > 3
ORDER BY cnt DESC
LIMIT 100`;

const SAMPLE_DM8 = `SELECT d.dept_name, e.emp_name, NVL(e.bonus, 0) AS bonus
FROM dm_emp e, dm_dept d
WHERE e.dept_id(+) = d.dept_id
  AND e.status = 1
  AND ROWNUM <= 100
ORDER BY e.hire_date DESC`;

let scrollNonce = 0;

export default function App() {
  const [sql, setSql] = useState(SAMPLE_MYSQL);
  const [dialect, setDialect] = useState<Dialect>('auto');
  const [activeLine, setActiveLine] = useState(1);
  const [scrollTarget, setScrollTarget] = useState<{ line: number; nonce: number } | null>(
    null,
  );

  const analysis = useMemo(() => analyzeSql(sql, dialect), [sql, dialect]);
  const clauses = useMemo(
    () => analysis.statements.flatMap((statement) => statement.clauses),
    [analysis],
  );
  const flows = useMemo(
    () =>
      analysis.statements.map((statement) => ({
        statement,
        steps: buildFlow(statement),
      })),
    [analysis],
  );
  const allSteps = useMemo(() => flows.flatMap((flow) => flow.steps), [flows]);

  const activeClause = clauses.find(
    (clause) => activeLine >= clause.span.startLine && activeLine <= clause.span.endLine,
  );
  const activeStep = allSteps.find(
    (step) => activeLine >= step.startLine && activeLine <= step.endLine,
  );
  const lineCount = sql ? sql.split('\n').length : 0;
  const highRiskCount = analysis.issues.filter((issue) => issue.severity === 'high').length;

  const requestScroll = (line: number) => {
    scrollNonce += 1;
    setScrollTarget({ line, nonce: scrollNonce });
  };

  const handleSelectClause = (clause: Clause) => {
    setActiveLine(clause.span.startLine);
    requestScroll(clause.span.startLine);
  };

  const handleSelectStep = (step: FlowStep) => {
    setActiveLine(step.startLine);
    requestScroll(step.startLine);
  };

  const handleSelectIssue = (issue: Issue) => {
    if (!issue.clauseId) return;
    const clause = clauses.find((item) => item.id === issue.clauseId);
    if (clause) handleSelectClause(clause);
  };

  const loadSample = (sample: string) => {
    setSql(sample);
    setActiveLine(1);
    requestScroll(1);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◈
          </span>
          <div>
            <h1>SQL 透视镜</h1>
            <p>把屎山 SQL 讲成人话</p>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="dialect-select">
            <span>方言</span>
            <select
              value={dialect}
              onChange={(event) => setDialect(event.target.value as Dialect)}
            >
              {DIALECT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <span className="local-badge" title="所有分析都在当前浏览器内完成">
            <span className="local-dot" aria-hidden="true" />
            本地运行
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="pane editor-pane" aria-label="SQL 输入">
          <div className="pane-head">
            <span className="pane-title">SQL 输入</span>
            <div className="pane-actions">
              <button type="button" onClick={() => loadSample(SAMPLE_MYSQL)}>
                MySQL 示例
              </button>
              <button type="button" onClick={() => loadSample(SAMPLE_DM8)}>
                DM8 示例
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setSql('');
                  setActiveLine(1);
                }}
              >
                清空
              </button>
            </div>
          </div>

          <Editor
            value={sql}
            onChange={setSql}
            onCursorLine={setActiveLine}
            scrollTarget={scrollTarget}
          />

          <div className="pane-foot">
            <span>
              {lineCount} 行 · {analysis.dialect ? DIALECT_LABEL[analysis.dialect] : '—'} ·{' '}
              {Math.round(analysis.confidence * 100)}% 置信
            </span>
            <span className="muted">结构模式</span>
          </div>
        </section>

        <section className="pane result-pane" aria-label="分析结果">
          <div className="summary-card">
            <div className="summary-top">
              <span className="eyebrow">一句话总结</span>
              <span className="dialect-chip">
                {DIALECT_LABEL[analysis.dialect]} · {Math.round(analysis.confidence * 100)}%
              </span>
            </div>
            <p className="summary-text">{analysis.summary}</p>
            <p className="summary-note">
              只做静态结构与语法解释；不连接数据库，不生成执行计划，不保证性能结论。
            </p>
          </div>

          <div className="metrics" role="list">
            <div className="metric" role="listitem">
              <span className="metric-value">{analysis.statements.length}</span>
              <span className="metric-label">语句</span>
            </div>
            <div className="metric" role="listitem">
              <span className="metric-value">{clauses.length}</span>
              <span className="metric-label">子句</span>
            </div>
            <div className="metric" role="listitem">
              <span className="metric-value">{analysis.issues.length}</span>
              <span className="metric-label">风险</span>
            </div>
            <div className="metric" role="listitem">
              <span className="metric-value">{lineCount}</span>
              <span className="metric-label">行</span>
            </div>
          </div>

          {analysis.warnings.length > 0 && (
            <details className="warnings">
              <summary>解析提示 {analysis.warnings.length} 条</summary>
              <ul>
                {analysis.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </details>
          )}

          {analysis.issues.length > 0 && (
            <section className="issues-card">
              <h2>
                风险体检
                <span className="issue-count">{analysis.issues.length}</span>
                {highRiskCount > 0 && <span className="issue-high">高 {highRiskCount}</span>}
              </h2>
              <ul>
                {analysis.issues.map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      className="issue-button"
                      onClick={() => handleSelectIssue(issue)}
                    >
                      <span className={`severity-dot severity-${issue.severity}`} aria-hidden="true" />
                      <span className="issue-main">
                        <span className="issue-title">
                          <code>{issue.ruleId}</code> {issue.title}
                        </span>
                        <span className="issue-location">
                          {issue.span ? `第 ${issue.span.startLine} 行` : statementLocation(issue)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="disclaimer">静态代码检查，不是执行计划，也不代表一定会慢。</p>
            </section>
          )}

          {flows.length > 0 && (
            <section className="flow-section" aria-label="执行流程">
              <div className="flow-head">
                <h2>执行流程</h2>
                <span className="muted">按实际求值顺序，不是书写顺序</span>
              </div>
              {flows.map((flow, index) => (
                <div key={flow.statement.id} className="flow-statement">
                  {flows.length > 1 && (
                    <div className="flow-statement-label">语句 {index + 1}</div>
                  )}
                  <FlowView
                    steps={flow.steps}
                    activeStepId={activeStep?.id}
                    onSelect={handleSelectStep}
                  />
                </div>
              ))}
            </section>
          )}

          <div className="result-head">
            <h2>逐句解释</h2>
            <span className="muted">点击任意一条，定位到原文</span>
          </div>

          <ClauseList
            statements={analysis.statements}
            explanations={analysis.explanations}
            issues={analysis.issues}
            activeClauseId={activeClause?.id}
            onSelect={handleSelectClause}
          />
        </section>
      </main>

      <footer className="statusbar">
        <span>本地分析 · 不上传 · 不落盘</span>
        <span className="muted">
          左侧色条对应子句 · 点击行可定位 · v0.1.0
        </span>
      </footer>
    </div>
  );
}

function statementLocation(issue: Issue): string {
  return issue.span ? `第 ${issue.span.startLine} 行` : '位置未知';
}
