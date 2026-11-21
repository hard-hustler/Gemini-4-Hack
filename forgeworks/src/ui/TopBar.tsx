import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  HelpCircle,
  Layers,
  Save,
  Cpu,
  Footprints,
  Orbit,
  Sparkles,
  Sun,
  Moon,
  BarChart3,
  ChevronDown,
  Camera,
  Wrench,
  Flame,
} from 'lucide-react';
import { useFactoryStore } from '../state/useFactoryStore';
import { HeatmapMode, SimSpeed } from '../types/factory';

const SPEEDS: Array<{ val: SimSpeed; label: string }> = [
  { val: 0, label: 'Pause' },
  { val: 1, label: '1x' },
  { val: 2, label: '2x' },
  { val: 5, label: '5x' },
  { val: 20, label: '20x' },
];

export const TopBar: React.FC = () => {
  const metrics = useFactoryStore((s) => s.metrics);
  const speed = useFactoryStore((s) => s.speed);
  const uiMode = useFactoryStore((s) => s.uiMode);
  const cameraMode = useFactoryStore((s) => s.cameraMode);
  const heatmapMode = useFactoryStore((s) => s.heatmapMode);
  const audioMuted = useFactoryStore((s) => s.audioMuted);
  const perfStats = useFactoryStore((s) => s.perfStats);
  const entities = useFactoryStore((s) => s.entities);
  const sidebarCollapsed = useFactoryStore((s) => s.sidebarCollapsed);

  const setSpeed = useFactoryStore((s) => s.setSpeed);
  const setUiMode = useFactoryStore((s) => s.setUiMode);
  const setCameraMode = useFactoryStore((s) => s.setCameraMode);
  const setHeatmapMode = useFactoryStore((s) => s.setHeatmapMode);
  const setActiveModal = useFactoryStore((s) => s.setActiveModal);
  const toggleAudioMute = useFactoryStore((s) => s.toggleAudioMute);
  const toggleSidebar = useFactoryStore((s) => s.toggleSidebar);
  const setDayTime = useFactoryStore((s) => s.setDayTime);

  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    window.addEventListener('mousedown', onOutside);
    return () => window.removeEventListener('mousedown', onOutside);
  }, [toolsOpen]);

  const isNight = Math.sin(metrics.dayTime * Math.PI * 2 - Math.PI / 2) < 0.16;
  const powerPct = Math.round(metrics.powerSatisfaction * 100);
  const powerOk = metrics.powerSupplyKW >= metrics.powerDemandKW;

  return (
    <>
      <header
        className="fixed top-2.5 left-2.5 right-2.5 z-30 flex items-center justify-between gap-2 xl:gap-3 px-3 xl:px-3.5 py-2 rounded-lg bg-[#101620]/95 border border-[#2a374b] shadow-xl"
        aria-label="Factory Telemetry and Controls"
      >
        {/* Zone 1: Brand + Plain-English Live Metrics */}
        <div className="flex items-center gap-2 xl:gap-3 shrink-0">
          <span
            className="font-bold tracking-[0.12em] text-sm xl:text-base text-white whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            FORGEWORKS
          </span>

          <div className="hidden md:flex items-center gap-2 xl:gap-2.5 text-xs text-[#94a3b8] border-l border-[#263347] pl-2.5 xl:pl-3 whitespace-nowrap">
            <span title="Factory Funds" data-testid="metric-money">
              Cash{' '}
              <strong className="font-mono text-[#10b981] tabular-nums">
                ${metrics.money.toLocaleString()}
              </strong>
            </span>
            <span aria-hidden="true" className="text-[#39485e]">
              ·
            </span>
            <span
              title={`${metrics.powerDemandKW} kW demand / ${metrics.powerSupplyKW} kW supply`}
              data-testid="metric-power"
            >
              Power{' '}
              <strong
                className={`font-mono tabular-nums ${
                  powerOk ? 'text-[#f59e0b]' : 'text-[#ef4444]'
                }`}
              >
                {powerPct}%
              </strong>
            </span>
            <span
              aria-hidden="true"
              className="hidden xl:inline text-[#39485e]"
            >
              ·
            </span>
            <span
              className="hidden xl:inline"
              title="Total parts shipped via Loading Docks"
            >
              Shipped{' '}
              <strong className="font-mono text-[#e2e8f0] tabular-nums">
                {metrics.totalItemsShipped}
              </strong>
            </span>
          </div>
        </div>

        {/* Zone 2: Simple Mode Toggle (Guided Tour vs Build) + Simulation Speed */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="flex items-center bg-[#0b1017] p-0.5 rounded-md border border-[#243144]"
            role="group"
            aria-label="Workspace Mode"
          >
            <button
              type="button"
              onClick={() => setUiMode('tour')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                uiMode === 'tour'
                  ? 'bg-[#f59e0b] text-[#0c1016] font-semibold'
                  : 'text-[#9fb0c7] hover:text-white'
              }`}
            >
              <Camera size={12} />
              <span>Guided Tour</span>
            </button>
            <button
              type="button"
              onClick={() => setUiMode('build')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                uiMode === 'build'
                  ? 'bg-[#f59e0b] text-[#0c1016] font-semibold'
                  : 'text-[#9fb0c7] hover:text-white'
              }`}
            >
              <Wrench size={12} />
              <span>Build Mode</span>
            </button>
          </div>

          <div
            className="hidden sm:flex items-center bg-[#0b1017] p-0.5 rounded-md border border-[#243144]"
            role="group"
            aria-label="Simulation Speed"
          >
            {SPEEDS.map((s) => (
              <button
                key={s.val}
                type="button"
                onClick={() => setSpeed(s.val)}
                className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                  speed === s.val
                    ? 'bg-[#2a384e] text-white font-semibold'
                    : 'text-[#8ea0b8] hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zone 3: Calm Utility Actions + Tools Dropdown */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleSidebar}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap cursor-pointer transition-colors ${
              !sidebarCollapsed
                ? 'bg-[#f59e0b]/20 border-[#f59e0b] text-[#fbbf24]'
                : 'bg-[#1a2332] border-[#2e3c52] text-[#e2e8f0] hover:bg-[#233044]'
            }`}
            aria-expanded={!sidebarCollapsed}
          >
            <BarChart3 size={13} />
            <span>Analytics</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setCameraMode(cameraMode === 'orbit' ? 'fps' : 'orbit')
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap cursor-pointer transition-colors ${
              cameraMode === 'fps'
                ? 'bg-[#f59e0b]/20 border-[#f59e0b] text-[#fbbf24]'
                : 'bg-[#1a2332] border-[#2e3c52] text-[#e2e8f0] hover:bg-[#233044]'
            }`}
          >
            {cameraMode === 'fps' ? (
              <Orbit size={13} />
            ) : (
              <Footprints size={13} />
            )}
            <span className="hidden xl:inline">
              {cameraMode === 'fps' ? 'Orbit (F)' : 'Walk (F)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDayTime(isNight ? 0.36 : 0.92)}
            className="p-1.5 rounded-md bg-[#1a2332] hover:bg-[#233044] border border-[#2e3c52] text-[#cbd5e1] cursor-pointer transition-colors"
            aria-label={isNight ? 'Switch to Daytime' : 'Switch to Nighttime'}
            title={isNight ? 'Switch to Daytime' : 'Switch to Nighttime'}
          >
            {isNight ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          {/* Clean Tools Dropdown for Advanced Features */}
          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#1a2332] border border-[#2e3c52] text-[#e2e8f0] hover:bg-[#233044] whitespace-nowrap cursor-pointer transition-colors"
            >
              <span>Tools</span>
              <ChevronDown size={13} />
            </button>

            {toolsOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-[230px] p-1.5 rounded-lg bg-[#111722] border border-[#2e3d54] shadow-2xl space-y-1 z-40"
              >
                <div className="px-2 py-1.5 border-b border-[#202b3c] space-y-1">
                  <label
                    htmlFor="tools-heatmap-select"
                    className="flex items-center gap-1.5 text-[11px] font-medium text-[#9fb0c7]"
                  >
                    <Flame size={12} className="text-[#f59e0b]" />
                    <span>Floor Heatmap</span>
                  </label>
                  <select
                    id="tools-heatmap-select"
                    aria-label="Floor Heatmap Overlay"
                    value={heatmapMode}
                    onChange={(e) =>
                      setHeatmapMode(e.target.value as HeatmapMode)
                    }
                    className="w-full px-2 py-1 text-xs rounded bg-[#1a2332] border border-[#2e3c52] text-[#e2e8f0] cursor-pointer"
                  >
                    <option value="none">Off</option>
                    <option value="congestion">Congestion Heatmap</option>
                    <option value="power">Power Usage Heatmap</option>
                  </select>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setToolsOpen(false);
                    setActiveModal('tech');
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Sparkles size={13} className="text-[#f59e0b]" />
                    Tech Tree
                  </span>
                  <span className="font-mono text-[11px] text-[#38bdf8] tabular-nums">
                    {metrics.researchPoints} RP
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setToolsOpen(false);
                    setActiveModal('blueprints');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                >
                  <Layers size={13} className="text-[#94a3b8]" />
                  <span>Blueprints Library</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setToolsOpen(false);
                    setActiveModal('saveLoad');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                >
                  <Save size={13} className="text-[#94a3b8]" />
                  <span>Save, Load &amp; Export</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setToolsOpen(false);
                    setActiveModal('architecture');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                >
                  <Cpu size={13} className="text-[#94a3b8]" />
                  <span>Engine Architecture</span>
                </button>

                <div className="border-t border-[#202b3c] pt-1 space-y-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={toggleAudioMute}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                  >
                    {audioMuted ? (
                      <VolumeX size={13} className="text-[#94a3b8]" />
                    ) : (
                      <Volume2 size={13} className="text-[#94a3b8]" />
                    )}
                    <span>{audioMuted ? 'Unmute Sound' : 'Mute Sound'}</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setToolsOpen(false);
                      setActiveModal('help');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#e2e8f0] hover:bg-[#1d283a] cursor-pointer"
                  >
                    <HelpCircle size={13} className="text-[#94a3b8]" />
                    <span>Shortcuts &amp; Guide (?)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Compact Performance Readout */}
      <div
        className="fixed top-[58px] left-2.5 z-10 flex items-center gap-2.5 px-2.5 py-1 rounded-md bg-[#101620]/85 border border-[#243144] font-mono text-[11px] text-[#9fb0c7] tabular-nums"
        data-testid="perf-overlay"
      >
        <span>
          <strong
            className={
              perfStats.fps >= 45 ? 'text-[#10b981]' : 'text-[#f59e0b]'
            }
          >
            {perfStats.fps}
          </strong>{' '}
          FPS
        </span>
        <span aria-hidden="true" className="text-[#3b4b63]">
          ·
        </span>
        <span>{perfStats.drawCalls} Calls</span>
        <span aria-hidden="true" className="text-[#3b4b63]">
          ·
        </span>
        <span>{entities.length} Machines</span>
        <span aria-hidden="true" className="text-[#3b4b63]">
          ·
        </span>
        <span>{metrics.activeItemCount} Parts</span>
      </div>
    </>
  );
};
