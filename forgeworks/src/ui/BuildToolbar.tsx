import React from 'react';
import {
  RotateCw,
  Trash2,
  SquareDashedMousePointer,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import { MACHINE_ORDER, MACHINES, TECH_TREE } from '../data/catalog';
import { useFactoryStore } from '../state/useFactoryStore';

const ROT_NAMES = ['N', 'E', 'S', 'W'];

export const BuildToolbar: React.FC = () => {
  const uiMode = useFactoryStore((s) => s.uiMode);
  const selectedTool = useFactoryStore((s) => s.selectedTool);
  const deleteMode = useFactoryStore((s) => s.deleteMode);
  const blueprintMode = useFactoryStore((s) => s.blueprintMode);
  const activeBlueprint = useFactoryStore((s) => s.activeBlueprint);
  const rotation = useFactoryStore((s) => s.rotation);
  const unlockedTechIds = useFactoryStore((s) => s.unlockedTechIds);
  const money = useFactoryStore((s) => s.metrics.money);
  const undoCount = useFactoryStore((s) => s.undoStack.length);
  const redoCount = useFactoryStore((s) => s.redoStack.length);

  const selectTool = useFactoryStore((s) => s.selectTool);
  const toggleDeleteMode = useFactoryStore((s) => s.toggleDeleteMode);
  const toggleBlueprintMode = useFactoryStore((s) => s.toggleBlueprintMode);
  const selectBlueprintToStamp = useFactoryStore(
    (s) => s.selectBlueprintToStamp
  );
  const rotateCW = useFactoryStore((s) => s.rotateCW);
  const undo = useFactoryStore((s) => s.undo);
  const redo = useFactoryStore((s) => s.redo);

  if (uiMode !== 'build') return null;

  const unlockedMachines = new Set<string>();
  for (const id of unlockedTechIds) {
    const node = TECH_TREE.find((t) => t.id === id);
    if (node) node.unlocksMachines.forEach((m) => unlockedMachines.add(m));
  }

  return (
    <nav
      aria-label="Factory Build Toolbar"
      className="fixed bottom-2.5 left-1/2 -translate-x-1/2 max-w-[calc(100vw-20px)] z-20 flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#101620]/95 border border-[#2a374b] shadow-2xl overflow-x-auto fw-scroll"
    >
      {/* Mode Controls: Rotate, Delete, Blueprint */}
      <div className="flex flex-col gap-1 pr-2 border-r border-[#2a3648] shrink-0">
        <button
          type="button"
          onClick={rotateCW}
          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] whitespace-nowrap cursor-pointer"
          title="Rotate Ghost 90° Clockwise (R)"
          data-testid="btn-rotate"
        >
          <RotateCw size={12} />
          <span>Dir: {ROT_NAMES[rotation]}</span>
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={toggleDeleteMode}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap cursor-pointer transition-colors ${
              deleteMode
                ? 'bg-[#ef4444]/20 border-[#ef4444] text-[#fca5a5]'
                : 'bg-[#1b2432] border-[#2e3c52] text-[#cbd5e1] hover:bg-[#253145]'
            }`}
            title="Demolish Machine (X)"
          >
            <Trash2 size={11} />
            <span>Del</span>
          </button>
          <button
            type="button"
            onClick={toggleBlueprintMode}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap cursor-pointer transition-colors ${
              blueprintMode
                ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#7dd3fc]'
                : 'bg-[#1b2432] border-[#2e3c52] text-[#cbd5e1] hover:bg-[#253145]'
            }`}
            title="Box-Select Blueprint Region (B)"
          >
            <SquareDashedMousePointer size={11} />
            <span>BP</span>
          </button>
        </div>
      </div>

      {/* 13 Placeable Entities */}
      <div className="flex items-center gap-1">
        {MACHINE_ORDER.map((mType, index) => {
          const def = MACHINES[mType];
          const unlocked = unlockedMachines.has(mType);
          const canAfford = money >= def.cost;
          const active = selectedTool === mType;

          return (
            <button
              key={mType}
              type="button"
              disabled={!unlocked}
              onClick={() => selectTool(active ? null : mType)}
              title={`${def.name} (Tier ${def.tier}) — ${def.description}`}
              className={`relative flex flex-col items-center justify-center min-w-[66px] px-1.5 py-1.5 rounded-md border transition-colors shrink-0 ${
                active
                  ? 'bg-[#f59e0b]/20 border-[#f59e0b] text-white cursor-pointer'
                  : unlocked
                  ? 'bg-[#171f2b] border-[#2a3648] text-[#dbe4f0] hover:bg-[#222d3f] hover:border-[#425470] cursor-pointer'
                  : 'bg-[#111720] border-[#1f2937] text-[#5c6d85] opacity-55 cursor-not-allowed'
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-sm mb-0.5"
                style={{ backgroundColor: def.color }}
                aria-hidden="true"
              />
              <span className="text-[10px] font-semibold whitespace-nowrap leading-tight">
                {def.shortName}
              </span>
              <span
                className={`font-mono text-[10px] tabular-nums leading-tight ${
                  !unlocked
                    ? 'text-[#64748b]'
                    : canAfford
                    ? 'text-[#f59e0b]'
                    : 'text-[#ef4444]'
                }`}
              >
                {unlocked ? `$${def.cost}` : `T${def.tier} Lock`}
              </span>
              {index < 9 && (
                <span className="absolute top-0.5 right-1 text-[9px] font-mono text-[#64748b]">
                  {index + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Undo / Redo */}
      <div className="flex flex-col gap-1 pl-2 border-l border-[#2a3648] shrink-0">
        <button
          type="button"
          disabled={undoCount === 0}
          onClick={undo}
          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={11} />
          <span className="font-mono tabular-nums">Undo ({undoCount})</span>
        </button>
        <button
          type="button"
          disabled={redoCount === 0}
          onClick={redo}
          className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={11} />
          <span className="font-mono tabular-nums">Redo ({redoCount})</span>
        </button>
      </div>

      {/* Active Blueprint Stamp Indicator */}
      {activeBlueprint && (
        <button
          type="button"
          onClick={() => selectBlueprintToStamp(null)}
          className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-md bg-[#38bdf8]/20 border border-[#38bdf8] text-[#7dd3fc] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Stamp: {activeBlueprint.name.slice(0, 14)}</span>
          <X size={13} />
        </button>
      )}
    </nav>
  );
};
