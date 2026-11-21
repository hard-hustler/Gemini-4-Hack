import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Wrench,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { tourNarrator } from '../audio/tourNarrator';
import { buildLiveTourScript } from '../audio/tourScript';
import { TOUR_STEPS } from '../data/tourSteps';
import { useFactoryStore } from '../state/useFactoryStore';

/**
 * Animated SVG portrait of Lead Plant Engineer Elena Vance wearing an OSHA hard hat & headset.
 * Her mouth animates smoothly while giving the live factory voice tour.
 */
const EngineerPortrait: React.FC<{ speaking: boolean }> = ({ speaking }) => {
  const [mouthFrame, setMouthFrame] = useState(0);

  useEffect(() => {
    if (!speaking) {
      setMouthFrame(0);
      return;
    }
    const id = window.setInterval(() => {
      setMouthFrame((f) => (f + 1) % 4);
    }, 135);
    return () => window.clearInterval(id);
  }, [speaking]);

  const mouthHeight = !speaking
    ? 2.2
    : mouthFrame === 0
      ? 4.8
      : mouthFrame === 1
        ? 7.2
        : mouthFrame === 2
          ? 3.4
          : 6.0;

  return (
    <div
      className={`relative w-14 h-14 rounded-lg shrink-0 overflow-hidden border transition-colors ${
        speaking
          ? 'border-[#f59e0b] bg-[#1b2738]'
          : 'border-[#2c3a4f] bg-[#151e2c]'
      }`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="w-full h-full block">
        {/* Background industrial studio frame */}
        <rect width="64" height="64" fill="#172233" />
        {/* Shoulders + Hi-Vis Safety Vest */}
        <path d="M10 64 C12 49 20 45 32 45 C44 45 52 49 54 64 Z" fill="#2c3748" />
        <path d="M16 64 L20 46 L27 47 L26 64 Z" fill="#c4e01c" />
        <path d="M48 64 L44 46 L37 47 L38 64 Z" fill="#c4e01c" />
        <rect x="19" y="54" width="6" height="3" fill="#e2e8f0" />
        <rect x="39" y="54" width="6" height="3" fill="#e2e8f0" />
        {/* Neck */}
        <rect x="27" y="39" width="10" height="8" rx="3" fill="#dca884" />
        {/* Hair behind ears */}
        <ellipse cx="32" cy="30" rx="13.5" ry="13" fill="#2a211c" />
        {/* Face */}
        <ellipse cx="32" cy="30" rx="11" ry="12" fill="#e2b08d" />
        {/* Safety Glasses */}
        <rect
          x="22"
          y="25.5"
          width="8.5"
          height="5"
          rx="1.8"
          fill="#1e293b"
          fillOpacity="0.22"
          stroke="#334155"
          strokeWidth="1.2"
        />
        <rect
          x="33.5"
          y="25.5"
          width="8.5"
          height="5"
          rx="1.8"
          fill="#1e293b"
          fillOpacity="0.22"
          stroke="#334155"
          strokeWidth="1.2"
        />
        <line x1="30.5" y1="27.8" x2="33.5" y2="27.8" stroke="#334155" strokeWidth="1.2" />
        {/* Eyes */}
        <circle cx="26.2" cy="28" r="1.4" fill="#1e293b" />
        <circle cx="37.8" cy="28" r="1.4" fill="#1e293b" />
        {/* Animated Speaking Mouth */}
        <rect
          x="28.5"
          y={35.2 - mouthHeight * 0.3}
          width="7"
          height={mouthHeight}
          rx={mouthHeight * 0.45}
          fill="#6b212a"
        />
        {/* Headset Mic Boom */}
        <rect x="18.5" y="26" width="3" height="6" rx="1.5" fill="#0f172a" />
        <path
          d="M20 31 Q22 36 27 36.5"
          fill="none"
          stroke="#0f172a"
          strokeWidth="1.4"
        />
        <circle cx="27.2" cy="36.5" r="1.3" fill="#334155" />
        {/* Yellow OSHA Hard Hat */}
        <path d="M18 23 C18 12 24 8 32 8 C40 8 46 12 46 23 Z" fill="#eab308" />
        <rect x="29.5" y="8" width="5" height="12" rx="2" fill="#facc15" />
        <rect x="15" y="21" width="34" height="3.2" rx="1.6" fill="#ca8a04" />
      </svg>

      {/* Subtle audio equalizer bars at bottom edge while speaking */}
      {speaking && (
        <div className="absolute bottom-0.5 left-1 right-1 flex items-end justify-center gap-0.5 h-2.5 bg-[#0b1018]/75 rounded px-1">
          {[0, 1, 2, 3, 4].map((idx) => {
            const h = 3 + ((mouthFrame + idx * 2) % 4) * 2;
            return (
              <span
                key={idx}
                className="w-1 bg-[#f59e0b] rounded-sm"
                style={{ height: `${h}px` }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export const FactoryTourBar: React.FC = () => {
  const uiMode = useFactoryStore((s) => s.uiMode);
  const activeTourStepId = useFactoryStore((s) => s.activeTourStepId);
  const autoTourPlaying = useFactoryStore((s) => s.autoTourPlaying);
  const voiceEnabled = useFactoryStore((s) => s.voiceEnabled);
  const tourSpeaking = useFactoryStore((s) => s.tourSpeaking);
  const audioMuted = useFactoryStore((s) => s.audioMuted);
  const metrics = useFactoryStore((s) => s.metrics);
  const entities = useFactoryStore((s) => s.entities);

  const goToTourStep = useFactoryStore((s) => s.goToTourStep);
  const setAutoTourPlaying = useFactoryStore((s) => s.setAutoTourPlaying);
  const toggleVoiceEnabled = useFactoryStore((s) => s.toggleVoiceEnabled);
  const setTourSpeaking = useFactoryStore((s) => s.setTourSpeaking);
  const toggleAudioMute = useFactoryStore((s) => s.toggleAudioMute);
  const setUiMode = useFactoryStore((s) => s.setUiMode);

  const [liveCaption, setLiveCaption] = useState<string>('');
  const advanceTimerRef = useRef<number | null>(null);
  const userTriggeredStepRef = useRef(false);

  const currentIndex = Math.max(
    0,
    TOUR_STEPS.findIndex((t) => t.id === activeTourStepId)
  );
  const step = TOUR_STEPS[currentIndex];
  const prevStep =
    TOUR_STEPS[(currentIndex - 1 + TOUR_STEPS.length) % TOUR_STEPS.length];
  const nextStep = TOUR_STEPS[(currentIndex + 1) % TOUR_STEPS.length];

  // Build fresh live-factory narration text whenever step or plant topology updates
  const dynamicNarration = useMemo(
    () => buildLiveTourScript(step.id, entities, metrics),
    // Recompute cleanly on step change, machine count change, or major rate changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      step.id,
      entities.length,
      metrics.powerSupplyKW,
      metrics.powerDemandKW,
      metrics.totalItemsShipped,
      metrics.bottleneckMachineId,
    ]
  );

  // Drive live voice narration during Auto-Tour OR when user manually steps to a station
  useEffect(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    if (uiMode !== 'tour') {
      tourNarrator.stop();
      setTourSpeaking(false);
      return;
    }

    const storeState = useFactoryStore.getState();
    const shouldNarrate = autoTourPlaying || userTriggeredStepRef.current;
    userTriggeredStepRef.current = false;

    if (!shouldNarrate || storeState.entities.length === 0) {
      setLiveCaption('');
      return;
    }

    const freshScript = buildLiveTourScript(
      activeTourStepId,
      storeState.entities,
      storeState.metrics
    );
    setLiveCaption(freshScript.text);

    tourNarrator.speak(
      freshScript.text,
      freshScript.estimatedDurationMs,
      voiceEnabled,
      {
        onStart: () => {
          setTourSpeaking(true);
        },
        onEnd: (completedNormally) => {
          setTourSpeaking(false);
          if (completedNormally && useFactoryStore.getState().autoTourPlaying) {
            advanceTimerRef.current = window.setTimeout(() => {
              const st = useFactoryStore.getState();
              if (!st.autoTourPlaying || st.uiMode !== 'tour') return;
              const idx = TOUR_STEPS.findIndex(
                (t) => t.id === st.activeTourStepId
              );
              const nxt = TOUR_STEPS[(idx + 1) % TOUR_STEPS.length];
              st.goToTourStep(nxt.id, false);
            }, 1300);
          }
        },
      }
    );

    return () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, [activeTourStepId, autoTourPlaying, uiMode, voiceEnabled, setTourSpeaking]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      tourNarrator.stop();
    };
  }, []);

  if (uiMode !== 'tour') return null;

  const liveRate = step.metricItem
    ? metrics.productionRates[step.metricItem] ?? 0
    : metrics.totalItemsShipped;
  const liveLabel = step.metricLabel ?? 'Parts Shipped';

  const handleManualStep = (targetId: string) => {
    soundEngine.unlock();
    userTriggeredStepRef.current = true;
    goToTourStep(targetId, true);
  };

  const handleToggleAutoTour = () => {
    soundEngine.unlock();
    const nextPlay = !autoTourPlaying;
    if (nextPlay) {
      userTriggeredStepRef.current = true;
      setAutoTourPlaying(true);
    } else {
      setAutoTourPlaying(false);
    }
  };

  return (
    <section
      aria-label="Guided Factory Tour and Live Voice Presenter"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 w-[840px] max-w-[calc(100vw-24px)] z-20 rounded-xl bg-[#101620]/95 border border-[#2a374b] shadow-2xl overflow-hidden"
    >
      {/* Top Live Engineer Story Card */}
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-[#202b3c]">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <EngineerPortrait speaking={tourSpeaking} />

          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span className="font-semibold text-white">
                Elena Vance
              </span>
              <span className="text-[#64748b]">·</span>
              <span className="font-medium text-[#f59e0b]">
                {step.stepNumber}
              </span>
              <span aria-hidden="true" className="text-[#475569]">
                ·
              </span>
              <span className="font-mono text-[#cbd5e1] tabular-nums">
                {liveRate} {liveLabel}
              </span>
              {tourSpeaking && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-[#fbbf24]">
                  Speaking
                </span>
              )}
            </div>

            <h2 className="text-sm font-bold text-white leading-snug">
              {step.title}
            </h2>

            <p
              className="text-xs text-[#cbd5e1] leading-relaxed"
              data-testid="tour-live-transcript"
            >
              {liveCaption || dynamicNarration.text}
            </p>

            {/* Plain-English Process Flow */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-[#94a3b8]">
              {step.flow.map((stage, i) => (
                <React.Fragment key={stage}>
                  <span className="font-medium text-[#e2e8f0]">{stage}</span>
                  {i < step.flow.length - 1 && (
                    <ArrowRight
                      size={11}
                      className="text-[#f59e0b] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Playback, Voice & Sound Controls */}
        <div className="flex sm:flex-col items-center sm:items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleAutoTour}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                autoTourPlaying
                  ? 'bg-[#f59e0b] text-[#0c1016] hover:bg-[#fbbf24]'
                  : 'bg-[#1c2636] border border-[#314158] text-[#e2e8f0] hover:bg-[#263449]'
              }`}
              aria-label={
                autoTourPlaying
                  ? 'Pause Live Auto-Tour'
                  : 'Start Live Voice Auto-Tour'
              }
            >
              {autoTourPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{autoTourPlaying ? 'Touring' : 'Auto-Tour'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleManualStep(prevStep.id)}
              className="p-1.5 rounded-md bg-[#1c2636] border border-[#314158] text-[#cbd5e1] hover:bg-[#263449] hover:text-white cursor-pointer"
              aria-label="Previous Factory Step"
              title="Previous Step"
            >
              <ChevronLeft size={15} />
            </button>

            <button
              type="button"
              onClick={() => handleManualStep(nextStep.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#f59e0b] text-[#0c1016] text-xs font-semibold hover:bg-[#fbbf24] whitespace-nowrap cursor-pointer"
              aria-label="Next Factory Step"
            >
              <span>Next Step</span>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleVoiceEnabled}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border whitespace-nowrap cursor-pointer transition-colors ${
                voiceEnabled
                  ? 'bg-[#182334] border-[#334661] text-[#e2e8f0] hover:bg-[#223149]'
                  : 'bg-[#121822] border-[#263143] text-[#7c8da3] hover:text-white'
              }`}
              aria-label={
                voiceEnabled ? 'Mute Guide Voice' : 'Enable Guide Voice'
              }
              title={voiceEnabled ? 'Guide Voice On' : 'Guide Voice Off'}
            >
              {voiceEnabled ? (
                <Mic size={11} className="text-[#f59e0b]" />
              ) : (
                <MicOff size={11} />
              )}
              <span>{voiceEnabled ? 'Voice On' : 'Voice Off'}</span>
            </button>

            <button
              type="button"
              onClick={toggleAudioMute}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border whitespace-nowrap cursor-pointer transition-colors ${
                !audioMuted
                  ? 'bg-[#182334] border-[#334661] text-[#e2e8f0] hover:bg-[#223149]'
                  : 'bg-[#121822] border-[#263143] text-[#7c8da3] hover:text-white'
              }`}
              aria-label={
                audioMuted ? 'Enable Factory Sound' : 'Mute Factory Sound'
              }
              title={audioMuted ? 'Factory Sound Muted' : 'Factory Sound On'}
            >
              {audioMuted ? (
                <VolumeX size={11} />
              ) : (
                <Volume2 size={11} className="text-[#10b981]" />
              )}
              <span>{audioMuted ? 'SFX Off' : 'Factory Audio'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Camera Angle Selector Bar */}
      <div className="px-3 py-2 bg-[#0c1118] flex items-center justify-between gap-2 overflow-x-auto fw-scroll">
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Camera Angles"
        >
          {TOUR_STEPS.map((t) => {
            const active = t.id === step.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleManualStep(t.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#f59e0b] text-[#0c1016] font-semibold'
                    : 'text-[#9fb0c7] hover:text-white hover:bg-[#1a2433]'
                }`}
              >
                {t.shortLabel}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setUiMode('build')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[#cbd5e1] bg-[#17202e] border border-[#2c3a4f] hover:bg-[#223045] hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Wrench size={12} className="text-[#f59e0b]" />
          <span>Edit Factory</span>
        </button>
      </div>
    </section>
  );
};
