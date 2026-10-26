import { Fragment } from 'react';
import type { FlowStep } from '../core/flow';

export interface FlowViewProps {
  steps: FlowStep[];
  activeStepId?: string;
  onSelect: (step: FlowStep) => void;
}

export function FlowView({ steps, activeStepId, onSelect }: FlowViewProps) {
  if (steps.length === 0) return null;

  return (
    <div className="flow-track" role="list" aria-label="SQL 逻辑执行流程">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && (
            <span className="flow-arrow" aria-hidden="true">
              →
            </span>
          )}
          <button
            type="button"
            role="listitem"
            className={`flow-step flow-effect-${step.effect}${
              step.id === activeStepId ? ' is-active' : ''
            }`}
            onClick={() => onSelect(step)}
            title={`${step.label}：第 ${step.startLine}–${step.endLine} 行`}
          >
            <span className="flow-index">{index + 1}</span>
            {step.branch ? <span className="flow-branch">分支 {step.branch}</span> : null}
            <span className="flow-label">{step.label}</span>
            <span className="flow-title">{step.title}</span>
            <span className="flow-detail">{step.detail}</span>
            <span className="flow-lines">
              L{step.startLine}
              {step.endLine !== step.startLine ? `–${step.endLine}` : ''}
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
