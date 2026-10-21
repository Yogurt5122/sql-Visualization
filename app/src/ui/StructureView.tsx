import { useMemo, useState } from 'react';
import type { StructureNode } from '../core/structure';
import { filterStructure, findActiveNode } from '../core/structure';

export interface StructureViewProps {
  roots: StructureNode[];
  activeLine: number;
  onSelect: (node: StructureNode) => void;
}

interface TreeRowProps {
  node: StructureNode;
  depth: number;
  activeId?: string;
  collapsed: Set<string>;
  forceExpand: boolean;
  onToggle: (id: string) => void;
  onSelect: (node: StructureNode) => void;
}

function TreeRow({
  node,
  depth,
  activeId,
  collapsed,
  forceExpand,
  onToggle,
  onSelect,
}: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.id) && !forceExpand;

  return (
    <>
      <div
        className={`tree-row${node.id === activeId ? ' is-active' : ''}`}
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          className={`tree-chevron${hasChildren ? '' : ' is-leaf'}`}
          onClick={() => onToggle(node.id)}
          disabled={!hasChildren}
          aria-label={isCollapsed ? '展开' : '折叠'}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>

        <span className={`tree-badge tree-badge-${node.kind}`}>{node.badge}</span>

        <button
          type="button"
          className="tree-label"
          onClick={() => onSelect(node)}
          title={node.label}
        >
          {node.label}
        </button>

        <span className="tree-lines">
          {node.startLine === node.endLine
            ? `第 ${node.startLine} 行`
            : `第 ${node.startLine}–${node.endLine} 行`}
        </span>
      </div>

      {!isCollapsed && hasChildren && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              collapsed={collapsed}
              forceExpand={forceExpand}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function StructureView({ roots, activeLine, onSelect }: StructureViewProps) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyTables, setOnlyTables] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(
    () => filterStructure(roots, query, onlyTables),
    [roots, query, onlyTables],
  );
  const active = findActiveNode(filtered, activeLine);
  const forceExpand = query.trim() !== '' || onlyTables;

  const toggle = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="structure-section" aria-label="结构">
      <div className="structure-head">
        <button
          type="button"
          className="structure-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="structure-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          结构
        </button>
        <span className="muted">语句 → 子句 → 子查询 / CTE</span>
      </div>

      {open && (
        <>
          <div className="structure-tools">
            <input
              type="search"
              className="structure-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索表名 / 字段 / 关键字"
              aria-label="搜索结构树"
            />
            <label className="structure-check">
              <input
                type="checkbox"
                checked={onlyTables}
                onChange={(event) => setOnlyTables(event.target.checked)}
              />
              只看含表
            </label>
          </div>

          <div className="structure-tree" role="tree" aria-label="SQL 结构树">
            {filtered.length === 0 ? (
              <div className="structure-empty">没有匹配的节点</div>
            ) : (
              filtered.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  activeId={active?.id}
                  collapsed={collapsed}
                  forceExpand={forceExpand}
                  onToggle={toggle}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
