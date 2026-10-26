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
}

export function OutputPreview({
  relations,
  statementIndex,
  statementCount,
}: OutputPreviewProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [copied, setCopied] = useState(false);
  const rows = relations?.lineage ?? [];

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
        <div className="output-preview-table-wrap">
          <table className="output-preview-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unknown = row.output === '*' || row.output.endsWith('.*');
                return (
                  <tr key={row.id}>
                    <td>
                      <code className="output-preview-name" title={row.output}>
                        {row.output}
                      </code>
                    </td>
                    <td>
                      <span className="output-preview-type">{row.type ?? '—'}</span>
                    </td>
                    <td>
                      <span className="output-preview-source" title={row.source}>
                        {row.source}
                      </span>
                      {unknown ? (
                        <span className="output-preview-unknown">具体列未知</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </aside>
  );
}
