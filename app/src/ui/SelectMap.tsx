import type { CSSProperties } from 'react';
import type { Relations } from '../core/types';
import { sourceColor, sourceTable, sourceTables } from './visual';

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

export interface SelectMapProps {
  relations?: Relations;
  highlightTable?: string;
  highlightField?: string;
  onSelectLine: (line: number) => void;
  onHighlight?: (table: string, source: string) => void;
}

export function SelectMap({
  relations,
  highlightTable,
  highlightField,
  onSelectLine,
  onHighlight,
}: SelectMapProps) {
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
          {hasUnknown ? '全部字段' : `${rows.length} 个字段`} · {tables.length} 个来源 · 点击字段联动关系图
        </span>
      </div>

      <div className="select-map-legend" aria-label="来源表图例">
        {tables.map((table) => (
          <span key={table} className="select-map-legend-item">
            <i style={{ background: sourceColor(table) }} aria-hidden="true" />
            {table}
          </span>
        ))}
      </div>

      <div className="select-map-grid">
        {rows.map((row) => {
          const table = sourceTable(row.source);
          const color = sourceColor(table);
          const style = { '--field-color': color } as CSSProperties;
          const unknown = row.output === '*' || row.output.endsWith('.*');
          const isActive =
            highlightField === row.source || (!highlightField && highlightTable === table);

          return (
            <button
              key={row.id}
              type="button"
              className={`select-map-card${unknown ? ' is-unknown' : ''}${
                isActive ? ' is-active' : ''
              }`}
              style={style}
              onClick={() => {
                onHighlight?.(table, row.source);
                onSelectLine(row.line);
              }}
              title={`${sourceTables(row.source).join('、')} · 定位到第 ${row.line} 行`}
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
