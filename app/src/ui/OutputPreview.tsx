import { useEffect, useState } from 'react';
import type { LineageRow, Relations } from '../core/types';

const COLLAPSE_KEY = 'sql-xray:output-preview:collapsed';

export function formatFieldList(rows: LineageRow[]): string {
  return rows.map((row) => row.output).join('\n');
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface OutputPreviewProps {
  relations?: Relations;
  statementIndex: number;
  statementCount: number;
  onSelectLine?: (line: number) => void;
}

export function OutputPreview({
  relations,
  statementIndex,
  statementCount,
  onSelectLine,
}: OutputPreviewProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [copied, setCopied] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailQuery, setDetailQuery] = useState('');
  const rows = relations?.lineage ?? [];

  useEffect(() => {
    if (!detailOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // 隐私模式或禁用 localStorage 时，状态只保留在当前页面。
    }
  }, [collapsed]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (rows.length === 0) return null;

  const hasStar = rows.some(
    (row) => row.output === '*' || row.output.endsWith('.*'),
  );
  const countLabel = hasStar ? '全部字段' : `${rows.length} 个字段`;
  const detailRows = rows.filter((row) => {
    const keyword = detailQuery.trim().toLowerCase();
    if (!keyword) return true;
    return `${row.output} ${row.source} ${row.type ?? ''}`.toLowerCase().includes(keyword);
  });

  const copyFields = async () => {
    const text = formatFieldList(rows);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
  };

  return (
    <aside
      className={`output-preview${collapsed ? ' is-collapsed' : ''}`}
      aria-label="预输出字段"
    >
      <div className="output-preview-head">
        <span className="output-preview-title">预输出</span>
        {statementCount > 1 ? (
          <span className="output-preview-statement">语句 {statementIndex + 1}</span>
        ) : null}
        <span className="output-preview-count">{countLabel}</span>
        <button
          type="button"
          className="output-preview-detail"
          onClick={() => setDetailOpen(true)}
        >
          详情
        </button>
        <button type="button" className="output-preview-copy" onClick={copyFields}>
          {copied ? '已复制' : '复制'}
        </button>
        <button
          type="button"
          className="output-preview-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {!collapsed ? (
        <div className="output-preview-flow" role="list" aria-label="字段与来源">
          {rows.map((row) => {
            const unknown = row.output === '*' || row.output.endsWith('.*');
            return (
              <div className="output-preview-item" key={row.id} role="listitem">
                <code className="output-preview-name" title={row.output}>
                  {row.output}
                </code>
                <span
                  className={`output-preview-source${unknown ? ' is-unknown' : ''}`}
                  title={`${row.source}${row.type ? ` · ${row.type}` : ''}`}
                >
                  {row.source}
                  {unknown ? <em>具体列未知</em> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {detailOpen ? (
        <div
          className="output-detail-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailOpen(false);
          }}
        >
          <section
            className="output-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="output-detail-title"
          >
            <header className="output-detail-head">
              <div>
                <span className="output-detail-kicker">SELECT 输出</span>
                <h2 id="output-detail-title">预输出字段</h2>
                <p>
                  {countLabel}
                  {statementCount > 1 ? ` · 语句 ${statementIndex + 1}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="output-detail-close"
                onClick={() => setDetailOpen(false)}
                aria-label="关闭预输出详情"
              >
                ×
              </button>
            </header>

            <div className="output-detail-tools">
              <input
                type="search"
                value={detailQuery}
                onChange={(event) => setDetailQuery(event.target.value)}
                placeholder="搜索字段、类型或来源"
                aria-label="搜索预输出字段"
                autoFocus
              />
              <span>{detailRows.length} / {rows.length}</span>
              <button type="button" className="output-detail-copy" onClick={copyFields}>
                {copied ? '已复制' : '复制字段名'}
              </button>
            </div>

            <div className="output-detail-table-wrap">
              <table className="output-detail-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>类型</th>
                    <th>来源</th>
                    <th>行</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((row) => {
                    const unknown = row.output === '*' || row.output.endsWith('.*');
                    return (
                      <tr
                        key={row.id}
                        className={onSelectLine ? 'is-clickable' : ''}
                        onClick={() => {
                          if (!onSelectLine) return;
                          setDetailOpen(false);
                          onSelectLine(row.line);
                        }}
                      >
                        <td>
                          <code className="output-detail-name">{row.output}</code>
                          {unknown ? <span className="output-detail-unknown">具体列未知</span> : null}
                        </td>
                        <td>{row.type ?? '—'}</td>
                        <td className="output-detail-source">{row.source}</td>
                        <td>L{row.line}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {detailRows.length === 0 ? (
                <p className="output-detail-empty">没有匹配的字段。</p>
              ) : null}
            </div>

            <footer className="output-detail-foot">
              <span>点击任意行可定位原文</span>
              <button type="button" onClick={() => setDetailOpen(false)}>
                关闭
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
