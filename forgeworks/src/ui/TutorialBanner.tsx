import React from 'react';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { TUTORIAL_STEPS } from '../data/catalog';
import { useFactoryStore } from '../state/useFactoryStore';

export const TutorialBanner: React.FC = () => {
  const tutorialEnabled = useFactoryStore((s) => s.tutorialEnabled);
  const completed = useFactoryStore((s) => s.tutorialCompletedSteps);
  const dismissTutorial = useFactoryStore((s) => s.dismissTutorial);

  if (!tutorialEnabled) return null;

  const allDone = completed.length >= TUTORIAL_STEPS.length;
  const activeStep =
    TUTORIAL_STEPS.find((s) => !completed.includes(s.id)) ??
    TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];

  return (
    <section
      aria-label="Guided Tutorial"
      className="fixed bottom-[88px] left-2.5 z-10 w-[310px] max-w-[calc(100vw-20px)] p-3 rounded-lg bg-[#111720]/95 border border-[#2a3648] shadow-xl space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#f59e0b]">
          {allDone
            ? 'Tutorial Complete'
            : `Guide (${completed.length}/${TUTORIAL_STEPS.length})`}
        </span>
        <button
          type="button"
          onClick={dismissTutorial}
          className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-white cursor-pointer"
          aria-label="Dismiss Tutorial"
        >
          <X size={13} />
        </button>
      </div>

      {allDone ? (
        <p className="text-xs text-[#cbd5e1] leading-relaxed">
          You have mastered inspection, construction, heatmaps, AI optimization,
          and walking the factory floor. Scale up Robot Parts to complete
          high-value contracts.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-white">{activeStep.title}</div>
          <p className="text-[11px] text-[#9fb0c7] leading-relaxed">
            {activeStep.instruction}
          </p>
          <div className="flex items-center gap-1.5 pt-1">
            {TUTORIAL_STEPS.map((step) => {
              const done = completed.includes(step.id);
              return (
                <span
                  key={step.id}
                  title={step.title}
                  className={done ? 'text-[#10b981]' : 'text-[#475569]'}
                >
                  {done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
