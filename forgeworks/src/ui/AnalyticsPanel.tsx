import React from 'react';
import {
  ChevronRight,
  Crosshair,
  Wand2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  ITEM_ORDER,
  ITEMS,
  MACHINES,
  RECIPES,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../data/catalog';
import { useFactoryStore } from '../state/useFactoryStore';
import { RecipeId } from '../types/factory';

const Sparkline: React.FC<{ values: number[]; color: string }> = ({
  values,
  color,
}) => {
  const pts =
    values.length < 2
      ? '0,28 160,28'
      : values
          .map((v, i) => {
            const x = (i / (values.length - 1)) * 160;
            const y = 30 - Math.min(100, Math.max(0, v)) * 0.28;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
  return (
    <svg
      width="100%"
      height="34"
      viewBox="0 0 160 34"
      className="block"
      aria-label="Efficiency history sparkline"
    >
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
};

export const AnalyticsPanel: React.FC = () => {
  const sidebarTab = useFactoryStore((s) => s.sidebarTab);
  const sidebarCollapsed = useFactoryStore((s) => s.sidebarCollapsed);
  const metrics = useFactoryStore((s) => s.metrics);
  const entities = useFactoryStore((s) => s.entities);
  const contracts = useFactoryStore((s) => s.contracts);
  const selectedEntityId = useFactoryStore((s) => s.selectedEntityId);
  const suggestions = useFactoryStore((s) => s.suggestions);

  const setSidebarTab = useFactoryStore((s) => s.setSidebarTab);
  const toggleSidebar = useFactoryStore((s) => s.toggleSidebar);
  const runOptimizer = useFactoryStore((s) => s.runOptimizer);
  const focusTile = useFactoryStore((s) => s.focusTile);
  const selectEntity = useFactoryStore((s) => s.selectEntity);
  const setRecipe = useFactoryStore((s) => s.setRecipe);
  const toggleCornerFlip = useFactoryStore((s) => s.toggleCornerFlip);
  const spawnContract = useFactoryStore((s) => s.spawnContract);

  if (sidebarCollapsed) {
    return null;
  }

  const selectedEntity =
    entities.find((e) => e.id === selectedEntityId) ?? null;
  const bottleneckEntity =
    entities.find((e) => e.id === metrics.bottleneckMachineId) ?? null;

  const maxProd = Math.max(
    10,
    ...ITEM_ORDER.map((item) => metrics.productionRates[item] ?? 0)
  );
  const activeContractsCount = contracts.filter(
    (c) => c.status === 'active'
  ).length;

  return (
    <aside
      aria-label="Analytics, Inspector, and Contracts"
      className="fixed top-[58px] right-2.5 bottom-[152px] w-[320px] max-w-[calc(100vw-20px)] z-20 flex flex-col rounded-lg bg-[#101620]/95 border border-[#2a374b] shadow-2xl overflow-hidden"
    >
      {/* Tabs */}
      <div className="flex items-center border-b border-[#2a3648] bg-[#0e131b]">
        <button
          type="button"
          onClick={() => setSidebarTab('analytics')}
          className={`flex-1 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
            sidebarTab === 'analytics'
              ? 'border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5'
              : 'border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          Analytics
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab('inspector')}
          className={`flex-1 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
            sidebarTab === 'inspector'
              ? 'border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5'
              : 'border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          Inspector
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab('contracts')}
          className={`flex-1 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
            sidebarTab === 'contracts'
              ? 'border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5'
              : 'border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          Contracts ({activeContractsCount})
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="px-2.5 py-2.5 text-[#94a3b8] hover:text-white cursor-pointer"
          aria-label="Collapse Side Panel"
          title="Collapse Panel"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 fw-scroll">
        {sidebarTab === 'analytics' && (
          <>
            {/* Utilization & Bottleneck Detection */}
            <section className="space-y-2 pb-3 border-b border-[#232f40]">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-[#cbd5e1]">
                  Factory Health
                </h2>
                <span className="font-mono font-semibold text-[#10b981] tabular-nums">
                  {metrics.utilizationPct}% utilization
                </span>
              </div>
              <p className="text-xs text-[#9fb0c7] leading-relaxed">
                Bottleneck:{' '}
                <strong
                  className={
                    bottleneckEntity ? 'text-[#f87171]' : 'text-[#10b981]'
                  }
                >
                  {metrics.bottleneckReason}
                </strong>
              </p>
              {bottleneckEntity && (
                <button
                  type="button"
                  onClick={() => {
                    focusTile(bottleneckEntity.x, bottleneckEntity.z);
                    selectEntity(bottleneckEntity.id);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#ef4444]/15 border border-[#ef4444]/60 text-[#fca5a5] hover:bg-[#ef4444]/25 cursor-pointer transition-colors"
                >
                  <Crosshair size={13} />
                  <span>Focus Limiting Machine (#{bottleneckEntity.id})</span>
                </button>
              )}
            </section>

            {/* Production Rates (items/min) */}
            <section className="space-y-2 pb-3 border-b border-[#232f40]">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-[#cbd5e1]">
                  Production Rate (items/min)
                </h2>
                <span className="font-mono text-[11px] text-[#7c90ac] tabular-nums">
                  {metrics.totalItemsShipped} shipped
                </span>
              </div>
              <div className="space-y-1.5" data-testid="production-chart">
                {ITEM_ORDER.map((item) => {
                  const rate = metrics.productionRates[item] ?? 0;
                  const pct = Math.round((rate / maxProd) * 100);
                  return (
                    <div key={item} className="flex items-center gap-2 text-xs">
                      <span className="w-[78px] text-[11px] text-[#9fb0c7] truncate">
                        {ITEMS[item].name}
                      </span>
                      <div className="flex-1 h-2 bg-[#1a2230] rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-all duration-300"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: ITEMS[item].color,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[11px] text-[#e2e8f0] tabular-nums">
                        {rate}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Power Supply vs Demand Chart */}
            <section className="space-y-1.5 pb-3 border-b border-[#232f40]">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-[#cbd5e1]">
                  Power Supply vs Demand
                </h2>
                <span className="font-mono text-[11px] text-[#f59e0b] tabular-nums">
                  {Math.round(metrics.powerSatisfaction * 100)}% capacity
                </span>
              </div>
              <div className="bg-[#0b0f15] rounded-md p-2 border border-[#1f2a3a]">
                <svg width="100%" height="58" viewBox="0 0 260 58">
                  {(() => {
                    const hist = metrics.powerHistory;
                    const maxKW = Math.max(
                      300,
                      ...hist.map((h) => Math.max(h.supply, h.demand))
                    );
                    const toPts = (
                      pick: (h: { supply: number; demand: number }) => number
                    ) =>
                      hist.length < 2
                        ? '0,48 260,48'
                        : hist
                            .map((h, i) => {
                              const x = (i / (hist.length - 1)) * 260;
                              const y = 52 - (pick(h) / maxKW) * 44;
                              return `${x.toFixed(1)},${y.toFixed(1)}`;
                            })
                            .join(' ');
                    return (
                      <>
                        <polyline
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          points={toPts((h) => h.supply)}
                        />
                        <polyline
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2"
                          points={toPts((h) => h.demand)}
                        />
                      </>
                    );
                  })()}
                </svg>
                <div className="flex justify-between text-[11px] font-mono tabular-nums mt-1">
                  <span className="text-[#10b981]">
                    Supply {metrics.powerSupplyKW} kW
                  </span>
                  <span className="text-[#f59e0b]">
                    Demand {metrics.powerDemandKW} kW
                  </span>
                </div>
              </div>
            </section>

            {/* AI Optimization Assistant */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <h2 className="font-semibold text-[#cbd5e1]">
                  AI Optimization Assistant
                </h2>
              </div>
              <button
                type="button"
                onClick={runOptimizer}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-[#f59e0b] text-[#0c1016] hover:bg-[#fbbf24] cursor-pointer transition-colors"
                data-testid="btn-optimize"
              >
                <Wand2 size={14} />
                <span>Optimize Layout</span>
              </button>

              {suggestions.length > 0 && (
                <div className="space-y-2" data-testid="optimizer-results">
                  {suggestions.map((s) => (
                    <div
                      key={s.id}
                      className="p-2.5 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-[#f1f5f9]">
                          {s.title}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-semibold uppercase ${
                            s.severity === 'critical'
                              ? 'text-[#f87171]'
                              : s.severity === 'warning'
                              ? 'text-[#fbbf24]'
                              : 'text-[#38bdf8]'
                          }`}
                        >
                          {s.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9fb0c7] leading-relaxed">
                        {s.detail}
                      </p>
                      {s.targetX !== undefined && s.targetZ !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            focusTile(s.targetX!, s.targetZ!);
                            if (s.machineId) selectEntity(s.machineId);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-[#212c3d] border border-[#34445c] text-[#e2e8f0] hover:bg-[#2a384e] cursor-pointer"
                        >
                          <Crosshair size={11} />
                          <span>
                            Jump to ({s.targetX}, {s.targetZ})
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {sidebarTab === 'inspector' && (
          <div>
            {!selectedEntity ? (
              <div className="p-4 rounded-md bg-[#161e2b] border border-[#2a3648] text-xs text-[#9fb0c7] leading-relaxed">
                Click any machine on the 3D factory floor to inspect its live
                inventory, recipe configuration, wear level, uptime, and
                efficiency sparkline.
              </div>
            ) : (
              <div className="space-y-3" data-testid="machine-inspector">
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#232f40]">
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      {MACHINES[selectedEntity.type].name} #{selectedEntity.id}
                    </h2>
                    <div className="text-[11px] font-mono text-[#7c90ac] mt-0.5 tabular-nums">
                      Tile ({selectedEntity.x}, {selectedEntity.z}) · Processed{' '}
                      {selectedEntity.itemsProcessed}
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-mono font-semibold"
                    style={{ color: STATUS_COLORS[selectedEntity.status] }}
                  >
                    {STATUS_LABELS[selectedEntity.status]}
                  </span>
                </div>

                {/* Recipe Selector for Smelter / Assembler */}
                {(selectedEntity.type === 'smelter' ||
                  selectedEntity.type === 'assembler') && (
                  <div className="space-y-1">
                    <label
                      htmlFor="inspector-recipe"
                      className="block text-[11px] font-semibold text-[#9fb0c7]"
                    >
                      Active Recipe
                    </label>
                    <select
                      id="inspector-recipe"
                      value={selectedEntity.recipeId ?? ''}
                      onChange={(e) =>
                        setRecipe(
                          selectedEntity.id,
                          (e.target.value || null) as RecipeId | null
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs rounded-md bg-[#1a2230] border border-[#2e3c52] text-white"
                    >
                      {Object.values(RECIPES)
                        .filter((r) => r.machine === selectedEntity.type)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} (
                            {r.inputs
                              .map((i) => `${i.count} ${ITEMS[i.item].name}`)
                              .join(' + ')}{' '}
                            → {r.output.count} {ITEMS[r.output.item].name})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Corner Flip for Conveyor Corner */}
                {selectedEntity.type === 'conveyor_corner' && (
                  <button
                    type="button"
                    onClick={() => toggleCornerFlip(selectedEntity.id)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] cursor-pointer"
                  >
                    <RefreshCw size={12} />
                    <span>
                      Flip Turn Direction (
                      {selectedEntity.cornerFlip ? 'Left' : 'Right'})
                    </span>
                  </button>
                )}

                {/* Progress / Fuel / Wear Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-[#161e2b] border border-[#253144]">
                    <div className="text-[10px] text-[#7c90ac]">Uptime</div>
                    <div className="font-mono font-semibold text-[#10b981] tabular-nums">
                      {selectedEntity.totalTicks > 0
                        ? Math.round(
                            (selectedEntity.workingTicks /
                              selectedEntity.totalTicks) *
                              100
                          )
                        : 0}
                      %
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#161e2b] border border-[#253144]">
                    <div className="text-[10px] text-[#7c90ac]">
                      Mechanical Wear
                    </div>
                    <div
                      className={`font-mono font-semibold tabular-nums ${
                        selectedEntity.wear > 70
                          ? 'text-[#ef4444]'
                          : 'text-[#e2e8f0]'
                      }`}
                    >
                      {Math.round(selectedEntity.wear)}%
                    </div>
                  </div>
                </div>

                {selectedEntity.type === 'generator' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#9fb0c7]">
                      <span>Coal Fuel Reserve</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(selectedEntity.fuel)}%
                      </span>
                    </div>
                    <div className="h-2 bg-[#1a2230] rounded overflow-hidden">
                      <div
                        className="h-full bg-[#f59e0b]"
                        style={{ width: `${selectedEntity.fuel}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Inventory Buffers */}
                <div className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-[#9fb0c7]">
                    Inventory Buffers
                  </h3>
                  <div className="p-2.5 rounded-md bg-[#161e2b] border border-[#253144] space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#7c90ac]">Inputs</span>
                      <span className="font-mono text-[#e2e8f0] text-right">
                        {Object.entries(selectedEntity.inputBuffer)
                          .filter(([, v]) => (v ?? 0) > 0)
                          .map(
                            ([k, v]) =>
                              `${ITEMS[k as keyof typeof ITEMS].name}: ${v}`
                          )
                          .join(', ') || 'Empty'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#7c90ac]">Outputs</span>
                      <span className="font-mono text-[#e2e8f0] text-right">
                        {Object.entries(selectedEntity.outputBuffer)
                          .filter(([, v]) => (v ?? 0) > 0)
                          .map(
                            ([k, v]) =>
                              `${ITEMS[k as keyof typeof ITEMS].name}: ${v}`
                          )
                          .join(', ') || 'Empty'}
                      </span>
                    </div>
                    {MACHINES[selectedEntity.type].isConveyor && (
                      <div className="flex justify-between">
                        <span className="text-[#7c90ac]">On Belt</span>
                        <span className="font-mono text-[#fbbf24] tabular-nums">
                          {selectedEntity.beltItems.length} / 4 slots
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Efficiency History Sparkline */}
                <div className="space-y-1">
                  <h3 className="text-[11px] font-semibold text-[#9fb0c7]">
                    Efficiency History (24s)
                  </h3>
                  <div className="p-2 rounded-md bg-[#0b0f15] border border-[#1f2a3a]">
                    <Sparkline
                      values={selectedEntity.efficiencyHistory}
                      color="#38bdf8"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {sidebarTab === 'contracts' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#cbd5e1]">
                Shipping Orders
              </h2>
              <button
                type="button"
                onClick={spawnContract}
                disabled={activeContractsCount >= 3}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#1b2432] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#253145] disabled:opacity-40 cursor-pointer"
              >
                <Plus size={12} />
                <span>New Order</span>
              </button>
            </div>

            {contracts.map((c) => {
              const pct = Math.min(
                100,
                Math.round((c.deliveredCount / c.targetCount) * 100)
              );
              const mins = Math.floor(c.remainingSec / 60);
              const secs = Math.floor(c.remainingSec % 60);
              return (
                <div
                  key={c.id}
                  className="p-2.5 rounded-md bg-[#161e2b] border border-[#2a3648] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-white">
                      {c.title}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold tabular-nums ${
                        c.status === 'completed'
                          ? 'text-[#10b981]'
                          : c.status === 'failed'
                          ? 'text-[#ef4444]'
                          : 'text-[#fbbf24]'
                      }`}
                    >
                      {c.status === 'active'
                        ? `${mins}:${String(secs).padStart(2, '0')}`
                        : c.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="h-2 bg-[#0d1219] rounded overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          c.status === 'completed'
                            ? '#10b981'
                            : c.status === 'failed'
                            ? '#ef4444'
                            : ITEMS[c.item].color,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[#9fb0c7] tabular-nums">
                    <span>
                      {c.deliveredCount}/{c.targetCount}
                    </span>
                    <span className="text-[#10b981]">
                      +${c.rewardMoney} · +{c.rewardRP} RP
                    </span>
                  </div>
                  <div className="text-[10px] text-[#7c90ac]">
                    Late penalty: -${c.penaltyMoney}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
