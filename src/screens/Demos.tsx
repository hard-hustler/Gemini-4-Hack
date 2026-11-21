import { useState } from 'react';
import { DEMOS, loadDemo, type Demo } from '../demos';
import type { Project } from '../store';
import { Notice, TopBar } from '../ui/common';
import { Icon } from '../ui/icons';

export function Demos({ onHome, onOpen }: { onHome: () => void; onOpen: (p: Project) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (demo: Demo) => {
    setLoading(demo.id);
    setError(null);
    try {
      onOpen(await loadDemo(demo));
    } catch (e) {
      setError((e as Error).message);
      setLoading(null);
    }
  };
  return (
    <div className="page">
      <TopBar onHome={onHome} />
      <main className="catalog">
        <h1>Demos</h1>
        <p className="lede">Projects the harness has built, saved as they came out. Open one to walk the floor, change it, and run the improve loop on it. Each opens as a copy of your own.</p>
        {error && <Notice tone="error" title={error} onClose={() => setError(null)} />}
        <div className="demo-grid">
          {DEMOS.map((d) => (
            <button key={d.id} className="demo-card" onClick={() => void open(d)} disabled={!!loading}>
              <span className="demo-img">
                <img src={d.image} alt="" loading="lazy" />
                <span className="demo-scale">{d.scale}</span>
              </span>
              <span className="demo-body">
                <b>{d.name}</b>
                <span className="muted">{d.blurb}</span>
                <span className="demo-stats">
                  {d.stats.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </span>
                <span className="demo-open">
                  {loading === d.id ? (
                    <>
                      <span className="spinner ink" /> Opening
                    </>
                  ) : (
                    <>
                      Open <Icon name="arrowRight" size={14} />
                    </>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
