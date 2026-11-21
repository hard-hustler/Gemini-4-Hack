import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Download, Upload, RotateCcw } from 'lucide-react';
import {
  ITEMS,
  MACHINES,
  RECIPES,
  SHORTCUTS,
  TECH_TREE,
} from '../data/catalog';
import { useFactoryStore } from '../state/useFactoryStore';

export const Modals: React.FC = () => {
  const activeModal = useFactoryStore((s) => s.activeModal);
  const setActiveModal = useFactoryStore((s) => s.setActiveModal);

  const unlockedTechIds = useFactoryStore((s) => s.unlockedTechIds);
  const metrics = useFactoryStore((s) => s.metrics);
  const blueprints = useFactoryStore((s) => s.blueprints);
  const exportedString = useFactoryStore((s) => s.exportedString);
  const lastAutosaveLabel = useFactoryStore((s) => s.lastAutosaveLabel);

  const unlockTech = useFactoryStore((s) => s.unlockTech);
  const selectBlueprintToStamp = useFactoryStore(
    (s) => s.selectBlueprintToStamp
  );
  const deleteBlueprint = useFactoryStore((s) => s.deleteBlueprint);
  const renameBlueprint = useFactoryStore((s) => s.renameBlueprint);
  const toggleBlueprintMode = useFactoryStore((s) => s.toggleBlueprintMode);
  const saveToSlot = useFactoryStore((s) => s.saveToSlot);
  const loadFromSlot = useFactoryStore((s) => s.loadFromSlot);
  const resetDemoFactory = useFactoryStore((s) => s.resetDemoFactory);
  const requestExportString = useFactoryStore((s) => s.requestExportString);
  const importFromString = useFactoryStore((s) => s.importFromString);
  const reopenTutorial = useFactoryStore((s) => s.reopenTutorial);

  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activeModal === 'saveLoad') {
      requestExportString();
    }
  }, [activeModal, requestExportString]);

  if (activeModal === 'none') return null;

  const titles: Record<Exclude<typeof activeModal, 'none'>, string> = {
    tech: 'Research & Technology Tree',
    blueprints: 'Factory Blueprints Library',
    saveLoad: 'Persistence, Save Slots & Sharing',
    help: 'Keyboard Shortcuts & Production Chain',
    architecture: 'FORGEWORKS Engine Architecture',
  };

  const handleCopy = () => {
    if (!exportedString) return;
    void navigator.clipboard?.writeText(exportedString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-heading"
      onClick={() => setActiveModal('none')}
    >
      <div
        className="w-full max-w-[760px] max-h-[84vh] flex flex-col rounded-lg bg-[#111720] border border-[#2e3c52] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#263244] bg-[#0e131b]">
          <h2
            id="modal-heading"
            className="text-base font-bold tracking-wide text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {titles[activeModal]}
          </h2>
          <button
            type="button"
            onClick={() => setActiveModal('none')}
            className="p-1.5 rounded bg-[#1b2432] hover:bg-[#263347] text-[#cbd5e1] cursor-pointer"
            aria-label="Close Modal"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 fw-scroll text-xs text-[#cbd5e1]">
          {activeModal === 'tech' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#232f40]">
                <span className="text-[#9fb0c7]">
                  Unlock advanced logistics, power efficiency, and laser
                  metrology across 3 industrial tiers.
                </span>
                <span className="font-mono font-semibold text-[#38bdf8] tabular-nums whitespace-nowrap">
                  ${metrics.money.toLocaleString()} · {metrics.researchPoints}{' '}
                  RP
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {TECH_TREE.map((node) => {
                  const unlocked = unlockedTechIds.includes(node.id);
                  const canAfford =
                    metrics.researchPoints >= node.rpCost &&
                    metrics.money >= node.moneyCost;

                  return (
                    <div
                      key={node.id}
                      className={`p-3.5 rounded-md border flex flex-col justify-between gap-3 ${
                        unlocked
                          ? 'bg-[#10b981]/10 border-[#10b981]/40'
                          : 'bg-[#161e2b] border-[#2a3648]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] text-[#f59e0b]">
                            Tier {node.tier}
                          </span>
                          <span className="font-mono text-[11px] text-[#9fb0c7] tabular-nums">
                            {node.rpCost} RP · ${node.moneyCost}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-white">
                          {node.name}
                        </h3>
                        <p className="text-xs text-[#9fb0c7] leading-relaxed">
                          {node.description}
                        </p>
                        {node.unlocksMachines.length > 0 && (
                          <div className="text-[11px] text-[#7c90ac] pt-1">
                            Unlocks:{' '}
                            <span className="text-[#e2e8f0]">
                              {node.unlocksMachines
                                .map((m) => MACHINES[m].shortName)
                                .join(', ')}
                            </span>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={unlocked || !canAfford}
                        onClick={() => unlockTech(node.id)}
                        className={`w-full py-1.5 rounded text-xs font-semibold transition-colors ${
                          unlocked
                            ? 'bg-[#10b981]/20 text-[#34d399] cursor-default'
                            : canAfford
                            ? 'bg-[#f59e0b] text-[#0c1016] hover:bg-[#fbbf24] cursor-pointer'
                            : 'bg-[#1f2937] text-[#64748b] cursor-not-allowed'
                        }`}
                      >
                        {unlocked
                          ? 'Unlocked'
                          : canAfford
                          ? 'Unlock Technology'
                          : 'Insufficient Funds or RP'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeModal === 'blueprints' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#232f40]">
                <p className="text-[#9fb0c7]">
                  Select any saved blueprint to stamp copies onto the floor, or
                  press B to box-select a new region.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal('none');
                    toggleBlueprintMode();
                  }}
                  className="px-3 py-1.5 rounded bg-[#f59e0b] text-[#0c1016] font-semibold whitespace-nowrap cursor-pointer hover:bg-[#fbbf24]"
                >
                  Box-Select Region (B)
                </button>
              </div>

              <div className="space-y-2">
                {blueprints.map((bp) => (
                  <div
                    key={bp.id}
                    className="p-3 rounded-md bg-[#161e2b] border border-[#2a3648] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="flex-1 min-w-[200px] space-y-1">
                      <input
                        type="text"
                        defaultValue={bp.name}
                        aria-label={`Rename blueprint ${bp.name}`}
                        onBlur={(e) => renameBlueprint(bp.id, e.target.value)}
                        className="w-full max-w-[280px] px-2 py-1 rounded bg-[#0e131b] border border-[#2a3648] text-xs font-semibold text-white"
                      />
                      <div className="text-[11px] font-mono text-[#7c90ac]">
                        {bp.width}×{bp.height} tiles · {bp.items.length}{' '}
                        entities
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => selectBlueprintToStamp(bp)}
                        className="px-3 py-1.5 rounded bg-[#38bdf8]/20 border border-[#38bdf8] text-[#7dd3fc] font-semibold hover:bg-[#38bdf8]/30 cursor-pointer"
                      >
                        Stamp Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBlueprint(bp.id)}
                        className="px-2.5 py-1.5 rounded bg-[#ef4444]/15 border border-[#ef4444]/50 text-[#fca5a5] hover:bg-[#ef4444]/25 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeModal === 'saveLoad' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">
                    Local Save Slots (Autosave every 60s · Last:{' '}
                    {lastAutosaveLabel})
                  </h3>
                  <button
                    type="button"
                    onClick={resetDemoFactory}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Restore Demo Factory</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(['slot1', 'slot2', 'slot3', 'autosave'] as const).map(
                    (slot) => {
                      const label =
                        slot === 'autosave'
                          ? 'Autosave Slot'
                          : `Save Slot ${slot.slice(-1)}`;
                      return (
                        <div
                          key={slot}
                          className="p-3 rounded-md bg-[#161e2b] border border-[#2a3648] flex items-center justify-between gap-2"
                        >
                          <span className="font-semibold text-white">
                            {label}
                          </span>
                          <div className="flex gap-1.5">
                            {slot !== 'autosave' && (
                              <button
                                type="button"
                                onClick={() => saveToSlot(slot)}
                                className="px-2.5 py-1 rounded bg-[#f59e0b] text-[#0c1016] font-semibold cursor-pointer hover:bg-[#fbbf24]"
                              >
                                Save
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => loadFromSlot(slot)}
                              className="px-2.5 py-1 rounded bg-[#1b2432] border border-[#34445c] text-[#e2e8f0] hover:bg-[#253145] cursor-pointer"
                            >
                              Load
                            </button>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Compressed JSON Export / Import */}
              <div className="space-y-2 pt-3 border-t border-[#232f40]">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">
                    Export Compressed Factory JSON
                  </h3>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={requestExportString}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b2432] border border-[#2e3c52] hover:bg-[#253145] cursor-pointer"
                    >
                      <Download size={12} />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#38bdf8]/20 border border-[#38bdf8] text-[#7dd3fc] hover:bg-[#38bdf8]/30 cursor-pointer"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copied ? 'Copied' : 'Copy String'}</span>
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={exportedString}
                  aria-label="Exported compressed factory string"
                  className="w-full h-20 p-2 rounded bg-[#0a0e14] border border-[#263244] font-mono text-[11px] text-[#9fb0c7] select-all"
                />
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-white">
                  Import Compressed Factory String
                </h3>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste FW1:... compressed string or raw factory JSON here"
                  aria-label="Import factory string"
                  className="w-full h-20 p-2 rounded bg-[#0a0e14] border border-[#263244] font-mono text-[11px] text-white"
                />
                <button
                  type="button"
                  disabled={!importText.trim()}
                  onClick={() => importFromString(importText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#10b981] text-[#052e16] font-semibold hover:bg-[#34d399] disabled:opacity-40 cursor-pointer"
                >
                  <Upload size={13} />
                  <span>Load Imported Factory</span>
                </button>
              </div>
            </div>
          )}

          {activeModal === 'help' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-semibold text-white">
                    Keyboard Shortcuts
                  </h3>
                  <div className="divide-y divide-[#1f2a3a] border border-[#263244] rounded-md bg-[#0e131b]">
                    {SHORTCUTS.map((s) => (
                      <div
                        key={s.key}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <kbd className="px-1.5 py-0.5 rounded bg-[#1c2533] border border-[#324157] font-mono text-[11px] text-[#fbbf24]">
                          {s.key}
                        </kbd>
                        <span className="text-[#cbd5e1] text-right">
                          {s.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold text-white">
                    Production Recipes
                  </h3>
                  <div className="space-y-2">
                    {Object.values(RECIPES).map((r) => (
                      <div
                        key={r.id}
                        className="p-2.5 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-1"
                      >
                        <div className="flex justify-between font-semibold text-white">
                          <span>{r.name}</span>
                          <span className="font-mono text-[#7c90ac]">
                            {MACHINES[r.machine].shortName} · {r.craftTimeSec}s
                          </span>
                        </div>
                        <div className="text-[11px] text-[#9fb0c7]">
                          {r.inputs
                            .map((i) => `${i.count}× ${ITEMS[i.item].name}`)
                            .join(' + ')}{' '}
                          → {r.output.count}× {ITEMS[r.output.item].name} ($
                          {ITEMS[r.output.item].sellPrice})
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      reopenTutorial();
                      setActiveModal('none');
                    }}
                    className="w-full mt-2 py-1.5 rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] cursor-pointer"
                  >
                    Show Guided Tutorial Overlay
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'architecture' && (
            <div className="space-y-4 leading-relaxed">
              <p className="text-[#cbd5e1]">
                FORGEWORKS decouples deterministic factory physics from WebGL
                rendering across two threads so heavy logistics and 5,000+
                moving items stay responsive.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-1.5">
                  <h3 className="font-semibold text-[#f59e0b]">
                    1. Fixed-Timestep Engine
                  </h3>
                  <p className="text-[#9fb0c7]">
                    Runs in <code className="font-mono">/src/engine</code> at a
                    deterministic 20 Hz step (dt = 0.05s) seeded with Mulberry32
                    PRNG. Speeds up to 20× sub-step cleanly without altering
                    recipe ratios, belt backpressure, or A* drone pathfinding.
                  </p>
                </div>
                <div className="p-3 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-1.5">
                  <h3 className="font-semibold text-[#38bdf8]">
                    2. Worker & Zero-Copy Buffer
                  </h3>
                  <p className="text-[#9fb0c7]">
                    <code className="font-mono">/src/workers/simWorker.ts</code>{' '}
                    executes ticks off the main thread. Active conveyor and
                    inserter items are packed into a compact stride-5{' '}
                    <code className="font-mono">Float32Array</code> and moved
                    via <code className="font-mono">Transferable</code>{' '}
                    ownership with zero JSON serialization overhead.
                  </p>
                </div>
                <div className="p-3 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-1.5">
                  <h3 className="font-semibold text-[#10b981]">
                    3. R3F Instanced Render Loop
                  </h3>
                  <p className="text-[#9fb0c7]">
                    <code className="font-mono">InstancedItems</code> reads the
                    mutable <code className="font-mono">Float32Array</code>{' '}
                    directly inside <code className="font-mono">useFrame</code>{' '}
                    with pre-allocated scratch transforms—rendering thousands of
                    3D parts in a single draw call without triggering React
                    re-renders.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-md bg-[#0d1219] border border-[#232f40] font-mono text-[11px] text-[#9fb0c7] whitespace-pre overflow-x-auto">
{`[User Input / React UI] ── WorkerCommand (PLACE, SPEED, RECIPE) ──▶ [Web Worker: 20Hz Sim]
                                                                            │
   ┌── Zustand Store (entities, metrics, heatmaps @ 10Hz) ◀─────────────────┤
   │                                                                        │
   └── liveItemBufferRef (Transferable Float32Array) ◀──────────────────────┘
                │
                ▼
     [Three.js / R3F useFrame @ 60Hz] ──▶ Single InstancedMesh Draw Call`}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
