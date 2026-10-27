import { useEffect } from 'react';
import type { Explanation } from '../core/types';
import type { StructureNode } from '../core/structure';

export interface StructureDetailProps {
  node: StructureNode;
  description?: string;
  snippet: string;
  explanations: Explanation[];
  onClose: () => void;
  onLocate: () => void;
}

export function StructureDetail({
  node,
  description,
  snippet,
  explanations,
  onClose,
  onLocate,
}: StructureDetailProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="structure-detail-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="structure-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="structure-detail-title"
      >
        <header className="structure-detail-head">
          <span className={`tree-badge tree-badge-${node.kind}`}>{node.badge}</span>
          <div>
            <h2 id="structure-detail-title">{node.label}</h2>
            <p>
              第 {node.startLine}
              {node.startLine !== node.endLine ? `–${node.endLine}` : ''} 行
            </p>
          </div>
          <button
            type="button"
            className="structure-detail-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="structure-detail-body">
          {description ? (
            <div className="structure-detail-block">
              <h3>它在做什么</h3>
              <p className="structure-detail-description">{description}</p>
            </div>
          ) : null}

          {explanations.length > 0 ? (
            <div className="structure-detail-block">
              <h3>这一段在做什么</h3>
              {explanations.map((explanation) => (
                <div className="structure-detail-explanation" key={explanation.clauseId}>
                  <p>{explanation.plain}</p>
                  <details>
                    <summary>技术细节</summary>
                    <pre>{explanation.technical}</pre>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <p className="structure-detail-empty">
              这个节点暂时没有逐句解释，可以直接看下面的原文。
            </p>
          )}

          <div className="structure-detail-block">
            <h3>原文</h3>
            <pre className="structure-detail-snippet">{snippet}</pre>
          </div>
        </div>

        <footer className="flow-detail-foot">
          <button type="button" className="flow-detail-locate" onClick={onLocate}>
            定位原文
          </button>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
