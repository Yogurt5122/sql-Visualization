import type { CSSProperties } from 'react';
import type { Relations } from '../core/types';

const COLORS = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];

const TRANSFORM_LABEL: Record<string, string> = {
  direct: '直接引用',
  aggregate: '聚合',
  window: '窗口',
  case: '条件',
  cast: '类型转换',
  function: '函数',
  literal: '常量',
  unknown: '未知',
};

function colorFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length]!;
}

function sourceTable(source: string): string {
  if (/按行计数|常量|表达式/.test(source)) return '计算值';
  const match = /([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)/.exec(source);
  if (!match) return '其他来源';
  return match[1]!.split('.')[0]!;
}

export interface SelectMapProps {
  relations?: Relations;
  onSelectLine: (line: number) => void;
}

export function SelectMap({ relations, onSelectLine }: SelectMapProps) {
  const rows = relations?.lineage ?? [];
  if (rows.length === 0) return null;

  const tables = [...new Set(rows.map((row) => sourceTable(row.source)))];
  const hasUnknown = rows.some((row) => row.output === '*' || row.output.endsWith('.*'));

  return (
    <section className="select-map" aria-label="SELECT 字段来源图">
      <div className="select-map-head">
        <div>
          <span className="eyebrow">SELECT 字段地图</span>
          <h2>输出字段与来源</h2>
        </div>
        <span className="select-map-summary">
          {hasUnknown ? '全部字段' : `${rows.length} 个字段`} · {tables.length} 个来源
        </span>
      </div>

      <div className="select-map-legend" aria-label="来源表图例">
        {tables.map((table) => (
          <span key={table} className="select-map-legend-item">
            <i style={{ background: colorFor(table) }} aria-hidden="true" />
            {table}
          </span>
        ))}
      </div>

      <div className="select-map-grid">
        {rows.map((row) => {
          const table = sourceTable(row.source);
          const color = colorFor(table);
          const style = { '--field-color': color } as CSSProperties;
          const unknown = row.output === '*' || row.output.endsWith('.*');

          return (
            <button
              key={row.id}
              type="button"
              className={`select-map-card${unknown ? ' is-unknown' : ''}`}
              style={style}
              onClick={() => onSelectLine(row.line)}
              title={`定位到第 ${row.line} 行`}
            >
              <span className="select-map-output">{row.output}</span>
              <span className="select-map-flow" aria-hidden="true">
                <i />
                <span>←</span>
              </span>
              <span className="select-map-source" title={row.source}>
                {row.source}
              </span>
              <span className="select-map-meta">
                <span className="select-map-table">{table}</span>
                <span>{row.type ?? TRANSFORM_LABEL[row.transform] ?? row.transform}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
