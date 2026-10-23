import { useState } from 'react';
import type { Relations } from '../core/types';

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
  const [collapsed, setCollapsed] = useState(false);
  const rows = relations?.lineage ?? [];
  if (rows.length === 0) return null;

  const hasStar = rows.some(
    (row) => row.output === '*' || row.output.endsWith('.*'),
  );
  const countLabel = hasStar ? '全部字段' : `${rows.length} 个字段`;

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
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unknown = row.output === '*' || row.output.endsWith('.*');
                return (
                  <tr key={row.id}>
                    <td>
                      <code className="output-preview-name">{row.output}</code>
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
