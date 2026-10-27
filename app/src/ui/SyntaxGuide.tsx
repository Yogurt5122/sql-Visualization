import { useEffect } from 'react';
import type { SyntaxEntry } from '../core/syntax';
import { SYNTAX_ENTRIES } from '../core/syntax';

export interface SyntaxGuideProps {
  entry: SyntaxEntry;
  onClose: () => void;
  onSelectKeyword: (keyword: string) => void;
}

export function SyntaxGuide({ entry, onClose, onSelectKeyword }: SyntaxGuideProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside className="syntax-guide" aria-label={`${entry.keyword} 语法说明`}>
      <header className="syntax-guide-head">
        <div>
          <span className="syntax-guide-kicker">{entry.category} · 关键字</span>
          <h3>{entry.keyword}</h3>
        </div>
        <button type="button" className="syntax-guide-close" onClick={onClose} aria-label="关闭语法说明">
          ×
        </button>
      </header>

      <div className="syntax-guide-body">
        <p className="syntax-guide-summary">{entry.summary}</p>

        <div className="syntax-guide-block">
          <h4>语法</h4>
          <pre>{entry.syntax}</pre>
        </div>

        <div className="syntax-guide-block">
          <h4>例子</h4>
          <pre>{entry.example}</pre>
        </div>

        <div className="syntax-guide-meta">
          <span>适用：{entry.dialects.join(' / ')}</span>
          {entry.note ? <span className="syntax-guide-note">{entry.note}</span> : null}
        </div>

        {entry.related && entry.related.length > 0 ? (
          <div className="syntax-guide-related">
            <span>相关：</span>
            {entry.related.map((keyword) => (
              <button
                key={keyword}
                type="button"
                disabled={!SYNTAX_ENTRIES[keyword]}
                onClick={() => onSelectKeyword(keyword)}
              >
                {keyword}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
