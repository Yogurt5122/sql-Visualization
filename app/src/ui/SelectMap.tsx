import { useState } from 'react';
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = relations?.lineage ?? [];
  if (rows.length === 0) return null;

  const groups = [...new Set(rows.map((row) => sourceTable(row.source)))].map((table) => ({
    table,
    rows: rows.filter((row) => sourceTable(row.source) === table),
  }));
  const hasUnknown = rows.some((row) => row.output === '*' || row.output.endsWith('.*'));

  const toggleGroup = (table: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const select = (table: string, source: string, line: number) => {
    onHighlight?.(table, source);
    onSelectLine(line);
  };

  return (
    <section className="select-map" aria-label="SELECT 字段来源图">
      <div className="select-map-head">
        <div>
          <span className="eyebrow">SELECT 字段地图</span>
          <h2>输出字段与来源</h2>
        </div>
        <span className="select-map-summary">
          {hasUnknown ? '全部字段' : `${rows.length} 个字段`} · {groups.length} 个来源
        </span>
      </div>

      <div className="select-map-groups">
        {groups.map((group) => {
          const color = sourceColor(group.table);
          const style = { '--field-color': color } as CSSProperties;
          const showCards = group.rows.length <= 6 || expanded.has(group.table);
          const visibleChips = group.rows.slice(0, 6);
          const rest = group.rows.length - visibleChips.length;

          return (
            <div className="select-map-group" key={group.table} style={style}>
              <div className="select-map-group-head">
                <span className="select-map-group-name">
                  <i style={{ background: color }} aria-hidden="true" />
                  {group.table}
                </span>
                <span className="select-map-group-count">{group.rows.length} 字段</span>
                {group.rows.length > 6 ? (
                  <button
                    type="button"
                    className="select-map-group-toggle"
                    aria-expanded={showCards}
                    onClick={() => toggleGroup(group.table)}
                  >
                    {showCards ? '收起' : '展开全部'}
                  </button>
                ) : null}
              </div>

              {showCards ? (
                <div className="select-map-grid">
                  {group.rows.map((row) => {
                    const unknown = row.output === '*' || row.output.endsWith('.*');
                    const isActive =
                      highlightField === row.source ||
                      (!highlightField && highlightTable === group.table);

                    return (
                      <button
                        key={row.id}
                        type="button"
                        className={`select-map-card${unknown ? ' is-unknown' : ''}${
                          isActive ? ' is-active' : ''
                        }`}
                        onClick={() => select(group.table, row.source, row.line)}
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
                          <span className="select-map-table">{group.table}</span>
                          <span>{row.type ?? TRANSFORM_LABEL[row.transform] ?? row.transform}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="select-map-chips">
                  {visibleChips.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`select-map-chip${
                        highlightField === row.source ? ' is-active' : ''
                      }`}
                      onClick={() => select(group.table, row.source, row.line)}
                      title={row.source}
                    >
                      {row.output}
                    </button>
                  ))}
                  {rest > 0 ? (
                    <button
                      type="button"
                      className="select-map-chip select-map-chip-more"
                      onClick={() => toggleGroup(group.table)}
                    >
                      +{rest}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
