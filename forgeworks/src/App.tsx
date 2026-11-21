import React, { useEffect } from 'react';
import { soundEngine } from './audio/soundEngine';
import { MACHINE_ORDER } from './data/catalog';
import { TOUR_STEPS } from './data/tourSteps';
import { SceneCanvas } from './render/SceneCanvas';
import { useFactoryStore } from './state/useFactoryStore';
import { AnalyticsPanel } from './ui/AnalyticsPanel';
import { BuildToolbar } from './ui/BuildToolbar';
import { FactoryTourBar } from './ui/FactoryTourBar';
import { Modals } from './ui/Modals';
import { TopBar } from './ui/TopBar';
import { TutorialBanner } from './ui/TutorialBanner';

export default function App() {
  const initWorker = useFactoryStore((s) => s.initWorker);
  const saveToSlot = useFactoryStore((s) => s.saveToSlot);
  const cameraMode = useFactoryStore((s) => s.cameraMode);
  const toastMessage = useFactoryStore((s) => s.toastMessage);
  const ready = useFactoryStore((s) => s.ready);

  useEffect(() => {
    initWorker();

    // Autosave every 60 seconds
    const autosaveTimer = window.setInterval(() => {
      saveToSlot('autosave');
    }, 60000);

    // Unlock realistic factory floor audio on first user gesture
    const onFirstGesture = () => {
      soundEngine.unlock();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });

    return () => {
      window.clearInterval(autosaveTimer);
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, [initWorker, saveToSlot]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const store = useFactoryStore.getState();

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (e.key === 'Escape') {
        if (store.activeModal !== 'none') {
          store.setActiveModal('none');
        } else if (store.cameraMode === 'fps') {
          store.setCameraMode('orbit');
        } else {
          store.selectTool(null);
          store.selectBlueprintToStamp(null);
          useFactoryStore.setState({ deleteMode: false, blueprintMode: false });
        }
        return;
      }

      if (store.activeModal !== 'none') return;

      const k = e.key.toLowerCase();
      if (k === 'r') {
        store.rotateCW();
      } else if (k === 'x') {
        store.toggleDeleteMode();
      } else if (k === 'b') {
        store.toggleBlueprintMode();
      } else if (k === 'f') {
        store.setCameraMode(store.cameraMode === 'orbit' ? 'fps' : 'orbit');
      } else if (e.key === ' ') {
        e.preventDefault();
        store.setSpeed(store.speed === 0 ? 1 : 0);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        store.setActiveModal('help');
      } else if (
        store.uiMode === 'tour' &&
        store.cameraMode === 'orbit' &&
        (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
      ) {
        const idx = TOUR_STEPS.findIndex(
          (t) => t.id === store.activeTourStepId
        );
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next =
          TOUR_STEPS[(idx + delta + TOUR_STEPS.length) % TOUR_STEPS.length];
        store.goToTourStep(next.id, true);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const mType = MACHINE_ORDER[idx];
        if (mType) store.selectTool(mType);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main
      className="relative w-full h-full overflow-hidden bg-[#0c1016] select-none"
      data-ready={ready ? 'true' : 'false'}
    >
      <SceneCanvas />
      <TopBar />
      <AnalyticsPanel />
      <FactoryTourBar />
      <BuildToolbar />
      <TutorialBanner />
      <Modals />

      {/* First-Person Mode Crosshair & Instructions */}
      {cameraMode === 'fps' && (
        <>
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-[#f59e0b]/90 pointer-events-none z-30"
            aria-hidden="true"
          />
          <div className="fixed top-[68px] left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-md bg-[#111720]/95 border border-[#f59e0b]/60 text-xs text-[#fde68a] pointer-events-none">
            First-Person Mode — Click canvas to look around · WASD to walk ·
            Shift to sprint · F or Esc to return to Orbit
          </div>
        </>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-[106px] left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-md bg-[#162030] border border-[#f59e0b] text-xs font-medium text-white shadow-xl"
        >
          {toastMessage}
        </div>
      )}
    </main>
  );
}
