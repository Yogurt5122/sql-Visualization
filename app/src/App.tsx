import { useEffect, useMemo, useRef, useState } from 'react';
import { buildFlow, type FlowStep } from './core/flow';
import { buildStructure, type StructureNode } from './core/structure';
import { DIALECT_LABEL, DIALECT_OPTIONS } from './core/dialects';
import { containsMybatisTags } from './core/mybatis-tags';
import type { Clause, Dialect, Issue, MybatisVariant } from './core/types';
import { useAnalysis } from './hooks/useAnalysis';
import { usePwa } from './hooks/usePwa';
import { useTheme, type ThemeMode } from './hooks/useTheme';
import { Editor } from './ui/Editor';
import { FlowView } from './ui/FlowView';
import { StructureView } from './ui/StructureView';
import { RelationsView } from './ui/RelationsView';
import { OutputPreview } from './ui/OutputPreview';
import { FlowDetail } from './ui/FlowDetail';

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

const SAMPLE_MYBATIS = `<select id="queryUser" resultType="User">
  SELECT u.id, u.name, u.status
  FROM sys_user u
  <where>
    <if test="status != null"> AND u.status = #{status} </if>
    <if test="name != null"> AND u.name LIKE CONCAT('%', #{name}, '%') </if>
  </where>
  ORDER BY u.id DESC
</select>`;

const SAMPLE_CTE = `WITH base AS (
  SELECT id, amount
  FROM dwd_order
  WHERE amount > 0
)
SELECT b.id, b.amount
FROM base b
WHERE b.amount > 100
ORDER BY b.amount DESC
LIMIT 50`;

const SAMPLE_MULTI = `SELECT id, name
FROM dwd_user
WHERE status = 1;

SELECT order_id, SUM(amount) AS total
FROM dwd_order
WHERE dt = '2024-12-01'
GROUP BY order_id
ORDER BY total DESC
LIMIT 20;`;

const SAMPLE_BROKEN = `SELECT
FROM dwd_order
WHERE dt = '2024-12-01';`;

const SAMPLE_RISK = `SELECT * FROM dwd_order o
JOIN dim_user u
WHERE o.user_id = u.id
LIMIT 10;`;

const SAMPLE_UNION = `SELECT o.order_id, o.pay_amount
FROM dwd_order o
WHERE o.dt = '2024-12-01'
UNION ALL
SELECT r.order_id, r.refund_amount
FROM dwd_refund r
WHERE r.dt = '2024-12-01';`;

const SAMPLE_QUERYBLOCK = `SELECT
  o.order_id,
  (SELECT MAX(r.refund_amount)
   FROM dwd_refund r
   WHERE r.order_id = o.order_id) AS max_refund
FROM dwd_order o
WHERE o.user_id IN (
  SELECT user_id
  FROM dim_user
  WHERE vip_level >= 3
);`;

let scrollNonce = 0;

function initialSql(): string {
  const sample = new URLSearchParams(window.location.search).get('sample');
  if (sample === 'mybatis') return SAMPLE_MYBATIS;
  if (sample === 'cte') return SAMPLE_CTE;
  if (sample === 'multi') return SAMPLE_MULTI;
  if (sample === 'broken') return SAMPLE_BROKEN;
  if (sample === 'risk') return SAMPLE_RISK;
  if (sample === 'union') return SAMPLE_UNION;
  if (sample === 'queryblocks') return SAMPLE_QUERYBLOCK;
  if (sample === 'dm8') return SAMPLE_DM8;
  return SAMPLE_MYSQL;
}

export default function App() {
  const { updateReady, applyUpdate } = usePwa();
  const { mode: themeMode, setMode: setThemeMode, resolved: theme } = useTheme();
  const [sql, setSql] = useState(initialSql);
  const [dialect, setDialect] = useState<Dialect>('auto');
  const [mybatisVariant, setMybatisVariant] = useState<MybatisVariant>('all');
  const [activeLine, setActiveLine] = useState(1);
  const [activeStatement, setActiveStatement] = useState(0);
  const [formatNotice, setFormatNotice] = useState<string | null>(null);
  const [flowDetail, setFlowDetail] = useState<{
    step: FlowStep;
    statementIndex: number;
  } | null>(null);
  const [scrollTarget, setScrollTarget] = useState<{ line: number; nonce: number } | null>(
    null,
  );
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const { analysis, status, runtime, phase, cancel, retry } = useAnalysis(
    sql,
    dialect,
    mybatisVariant,
  );
  const statementIndex =
    analysis.statements.length > 0
      ? Math.min(activeStatement, analysis.statements.length - 1)
      : 0;
  const activeMetrics =
    analysis.metricsByStatement[statementIndex] ?? analysis.metrics;
  const clauses = useMemo(
    () => analysis.statements.flatMap((statement) => statement.clauses),
    [analysis],
  );
  const flows = useMemo(
    () =>
      analysis.statements.map((statement, index) => ({
        statement,
        steps: buildFlow(statement, analysis.relations[index]),
      })),
    [analysis],
  );
  const allSteps = useMemo(() => flows.flatMap((flow) => flow.steps), [flows]);
  const structures = useMemo(
    () =>
      analysis.statements.map((statement, index) =>
        buildStructure(statement, analysis.semantic[index] ?? undefined),
      ),
    [analysis],
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
    const index = analysis.statements.findIndex((statement) =>
      statement.clauses.some((item) => item.id === clause.id),
    );
    if (index >= 0) setActiveStatement(index);
    setActiveLine(clause.span.startLine);
    requestScroll(clause.span.startLine);
  };

  const handleSelectStep = (step: FlowStep, index: number) => {
    setActiveStatement(index);
    setFlowDetail({ step, statementIndex: index });
  };

  const handleSelectNode = (node: StructureNode) => {
    setActiveLine(node.startLine);
    requestScroll(node.startLine);
  };

  const handleSelectLine = (line: number) => {
    setActiveLine(line);
    requestScroll(line);
  };

  const retryDialect = (next: Dialect) => {
    if (next === dialect) {
      retry();
      return;
    }
    setDialect(next);
  };

  const parseErrorMessage = (() => {
    if (!analysis.parseError) return '';
    const value = analysis.parseError.message.replace(/\s+/g, ' ').trim();
    return value.length > 220 ? `${value.slice(0, 220)}…` : value;
  })();

  const handleSelectIssue = (issue: Issue) => {
    if (!issue.clauseId) return;
    const clause = clauses.find((item) => item.id === issue.clauseId);
    if (clause) handleSelectClause(clause);
  };

  const loadSample = (sample: string) => {
    setSql(sample);
    setActiveLine(1);
    setActiveStatement(0);
    setFormatNotice(null);
    requestScroll(1);
  };

  const handleFormat = async () => {
    const source = sql;
    if (!source.trim()) {
      setFormatNotice('没有可美化的 SQL');
      return;
    }
    if (analysis.preprocess.detected || containsMybatisTags(source)) {
      setFormatNotice('MyBatis 动态 SQL 暂不美化');
      return;
    }

    setFormatNotice('正在加载格式化器…');
    try {
      const { formatSqlResult } = await import('./core/format');
      if (sqlRef.current !== source) {
        setFormatNotice('SQL 已变化，未应用格式化');
        return;
      }
      const formatted = formatSqlResult(source, analysis.dialect);
      if (!formatted.ok) {
        setFormatNotice('格式化失败，保留原文');
        return;
      }
      if (formatted.sql === source) {
        setFormatNotice('已经是格式化后的样子');
        return;
      }
      setSql(formatted.sql);
      setActiveLine(1);
      requestScroll(1);
      setFormatNotice('已美化');
    } catch {
      setFormatNotice('格式化失败，保留原文');
    }
  };

  useEffect(() => {
    if (!formatNotice) return;
    const timer = window.setTimeout(() => setFormatNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [formatNotice]);

  useEffect(() => {
    setFlowDetail(null);
  }, [sql]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      handleFormat();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // 快捷键始终使用当前 SQL / 方言
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, analysis]);

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

          <label className="theme-select">
            <span>主题</span>
            <select
              aria-label="主题"
              value={themeMode}
              onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
            >
              <option value="auto">跟随系统</option>
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </label>

          <span className="local-badge" title="所有分析都在当前浏览器内完成">
            <span className="local-dot" aria-hidden="true" />
            本地运行
          </span>
        </div>
      </header>

      {updateReady ? (
        <div className="pwa-update" role="status">
          <span>新版本已就绪，刷新后启用。</span>
          <button type="button" onClick={applyUpdate}>
            刷新更新
          </button>
        </div>
      ) : null}

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
              <button type="button" onClick={() => loadSample(SAMPLE_MYBATIS)}>
                MyBatis 示例
              </button>
              <button
                type="button"
                className="format-button"
                onClick={handleFormat}
                title="美化 SQL（Shift+Alt+F）"
              >
                美化
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setSql('');
                  setActiveLine(1);
                  setFormatNotice(null);
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
            theme={theme}
          />

          <OutputPreview
            relations={analysis.relations[statementIndex]}
            statementIndex={statementIndex}
            statementCount={analysis.statements.length}
          />

          <div className="pane-foot">
            <span>
              {lineCount} 行 · {analysis.dialect ? DIALECT_LABEL[analysis.dialect] : '—'} ·{' '}
              {Math.round(analysis.confidence * 100)}% 置信
              {formatNotice ? (
                <span className="format-notice" role="status">
                  {formatNotice}
                </span>
              ) : null}
            </span>
            <span className="muted">
              {status === 'analyzing' ? (
                <span className="analysis-status">
                  {phase ?? '分析中'}…
                  <button type="button" onClick={cancel}>
                    取消
                  </button>
                </span>
              ) : analysis.mode === 'semantic' ? (
                <>语义模式{runtime === 'worker' ? ' · Worker' : ''}</>
              ) : (
                <>结构模式{runtime === 'worker' ? ' · Worker' : ''}</>
              )}
            </span>
          </div>
        </section>

        <section className="pane result-pane" aria-label="分析结果">
          {status === 'analyzing' && analysis.statements.length === 0 ? (
            <div className="analysis-loading">正在分析 SQL…</div>
          ) : null}
          {analysis.statements.length > 1 && (
            <div className="statement-switch" role="tablist" aria-label="语句切换">
              {analysis.statements.map((statement, index) => (
                <button
                  key={statement.id}
                  type="button"
                  role="tab"
                  aria-selected={index === statementIndex}
                  className={index === statementIndex ? 'is-active' : ''}
                  onClick={() => setActiveStatement(index)}
                >
                  语句 {index + 1}
                </button>
              ))}
            </div>
          )}

          <div className="summary-card">
            <div className="summary-top">
              <span className="eyebrow">一句话总结</span>
              <span className="dialect-chip">
                {DIALECT_LABEL[analysis.dialect]} · {Math.round(analysis.confidence * 100)}%
              </span>
            </div>
            <p className="summary-text">
              {analysis.summaries[statementIndex] ?? analysis.summary}
            </p>
            <p className="summary-note">
              只做静态结构与语法解释；不连接数据库，不生成执行计划，不保证性能结论。
            </p>
          </div>

          {analysis.preprocess.detected && (
            <div className="mybatis-banner">
              <span>
                检测到 MyBatis 动态 SQL
                <span className="muted">
                  {' '}
                  · {analysis.preprocess.dynamicConditions} 个动态条件
                </span>
              </span>
              <div className="variant-switch" role="group" aria-label="MyBatis 变体">
                <button
                  type="button"
                  className={mybatisVariant === 'all' ? 'is-active' : ''}
                  onClick={() => setMybatisVariant('all')}
                >
                  全保留
                </button>
                <button
                  type="button"
                  className={mybatisVariant === 'none' ? 'is-active' : ''}
                  onClick={() => setMybatisVariant('none')}
                >
                  全去掉
                </button>
              </div>
            </div>
          )}

          {analysis.statements.some((statement) => statement.kind !== 'select') ? (
            <div className="dml-note">
              DML 暂只做结构解释，不生成关系图 / 字段血缘；导出不在 M3。
            </div>
          ) : null}

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

          <div className="metric-strip" role="list" aria-label="结构指标">
            {analysis.statements.length > 1 ? (
              <span className="metric-scope">语句 {statementIndex + 1} 指标</span>
            ) : null}
            <span role="listitem">表 {activeMetrics.tables}</span>
            <span role="listitem">JOIN {activeMetrics.joins}</span>
            <span role="listitem">输出 {activeMetrics.outputs} 列</span>
            <span role="listitem">嵌套深度 {activeMetrics.depth}</span>
            <span role="listitem">复杂度 {activeMetrics.complexity}</span>
          </div>

          {analysis.parseError && (
            <div className="parse-banner" role="alert">
              <div className="parse-banner-body">
                <strong>语义解析失败，已回退结构模式</strong>
                <p>
                  {analysis.parseError.line ? `第 ${analysis.parseError.line} 行` : ''}
                  {analysis.parseError.column
                    ? `${analysis.parseError.line ? ' ' : ''}第 ${analysis.parseError.column} 列`
                    : ''}
                  {analysis.parseError.line || analysis.parseError.column ? '：' : ''}
                  {parseErrorMessage || '解析器没有给出具体原因。'}
                </p>
              </div>
              <div className="parse-actions">
                {analysis.parseError.line ? (
                  <button
                    type="button"
                    onClick={() => handleSelectLine(analysis.parseError!.line!)}
                  >
                    定位第 {analysis.parseError.line} 行
                  </button>
                ) : null}
                {(['mysql', 'postgres', 'tsql'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={analysis.dialect === id ? 'is-active' : ''}
                    onClick={() => retryDialect(id)}
                  >
                    {DIALECT_LABEL[id]} 重试
                  </button>
                ))}
                <button type="button" onClick={retry}>
                  重试
                </button>
              </div>
            </div>
          )}

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
                {analysis.statements.length > 1 ? (
                  <span className="risk-scope">全文</span>
                ) : null}
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
                    activeStepId={flowDetail?.step.id ?? activeStep?.id}
                    onSelect={(step) => handleSelectStep(step, index)}
                  />
                </div>
              ))}
            </section>
          )}

          {structures.length > 0 && (
            <StructureView
              roots={structures}
              activeLine={activeLine}
              onSelect={handleSelectNode}
            />
          )}

          {analysis.relations.length > 0 && (
            <RelationsView
              relations={analysis.relations}
              statementIndex={statementIndex}
              semantic={analysis.semantic[statementIndex] ?? null}
              onSelectLine={handleSelectLine}
            />
          )}
        </section>
      </main>

      {flowDetail ? (
        <FlowDetail
          step={flowDetail.step}
          statementIndex={flowDetail.statementIndex}
          statementCount={analysis.statements.length}
          relations={analysis.relations[flowDetail.statementIndex]}
          explanations={analysis.explanations}
          issues={analysis.issues}
          onClose={() => setFlowDetail(null)}
          onLocate={() => {
            setActiveLine(flowDetail.step.startLine);
            requestScroll(flowDetail.step.startLine);
            setFlowDetail(null);
          }}
        />
      ) : null}

      <footer className="statusbar">
        <span>本地分析 · 不上传 · 不落盘</span>
        <span className="muted">
          左侧色条对应子句 · 点击行可定位 · v0.5.4
        </span>
      </footer>
    </div>
  );
}

function statementLocation(issue: Issue): string {
  return issue.span ? `第 ${issue.span.startLine} 行` : '位置未知';
}
