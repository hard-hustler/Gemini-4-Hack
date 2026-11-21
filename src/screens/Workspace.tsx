import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdvocateFinding, AdvocateReport, AdvocateRole, CharacterRole, FixProposal, TraceEvent } from '../contracts';
import { addSupportEquipment, ADVOCATE_CHARACTERS, ADVOCATE_ROLES, buildReport, computeCharacterWalkPlans, crewStartTargets, runDeterministicAdvocateAudit } from '../engines/advocate';
import { compare, evaluate, makeVersion, type Version } from '../engines/versions';
import { validate, type ValidationError } from '../engines/validate';
import { applyOp, type EditOp, type FactorySpec } from '../spec';
import { api, apiStream, ApiError, money, num, type Project } from '../store';
import { startRecording, type Recorder } from '../ui/audio';
import { Notice, RunStatus, TopBar, useRun } from '../ui/common';
import { Icon } from '../ui/icons';
import type { CrewBubble } from '../ui/AdvocateCharacters';
import { Scene, type Layers } from '../ui/Scene';

interface Deltas {
  uph: number;
  leadMin: number;
  costPerUnit: number;
  buildCost: number;
}
interface ActiveSpeech {
  role: CharacterRole;
  targetLabel: string;
  text: string;
  findingId?: string;
  loading: boolean;
  playing: boolean;
  error?: string;
}

const describeOp = (op: EditOp): string => {
  switch (op.op) {
    case 'move':
      return `Moved ${op.id} to ${op.x}, ${op.y}`;
    case 'rotate':
      return `Turned ${op.id} to ${op.rot}°`;
    case 'add':
      return op.station.name && op.station.name.toLowerCase().replace(/[^a-z]/g, '') !== op.station.type ? `Added ${op.station.name} at ${op.station.x}, ${op.station.y}${op.station.price ? ` · ${money(op.station.price)}` : ''}` : `Added ${op.station.id} (${op.station.type})`;
    case 'remove':
      return `Removed ${op.id}`;
    case 'moveDock':
      return `Moved dock ${op.index} to the ${{ N: 'north', S: 'south', E: 'east', W: 'west' }[op.wall]} wall, ${op.offset} m along`;
    case 'setParam':
      return `Set ${op.path} to ${op.value}`;
  }
};

const PANEL = 396;

/** True on screens too narrow for the panel to sit beside the floor. */
function useNarrow() {
  const query = '(max-width: 900px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

type Tab = 'overview' | 'evals' | 'equipment' | 'versions';

/** What one technician is doing while the evals run. */
type CrewLive = Partial<Record<AdvocateRole, { state: 'writing' | 'done' | 'failed'; text: string; top?: string }>>;

/** 18,000 dollars -> "$18k": prices on a button. */
const shortPrice = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`);

/** What stands behind a finding: the simulator measured it, code checked its numbers against the plant, or it is a technician's call. */
const proof = (f: AdvocateFinding) => (f.source === 'deterministic' ? 'measured' : f.verified ? 'numbers checked' : 'judgement');

/** How a finding gets fixed: measured ones by moving things, the rest as the technician said. */
const fixKind = (f: AdvocateFinding) => f.fix?.kind ?? (f.source === 'deterministic' ? 'layout' : 'spec');
function Stat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <b>
        {value}
        {unit && <small>{unit}</small>}
      </b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function DeltaLine({ d }: { d: Deltas }) {
  const part = (v: number, shown: string, unit: string, goodWhenNegative = true) => {
    const zero = !/[1-9]/.test(shown);
    return (
      <span className={zero ? 'muted' : v < 0 === goodWhenNegative ? 'good' : 'warn'}>
        {zero ? '' : v > 0 ? '+' : '−'}
        {shown} {unit}
      </span>
    );
  };
  return (
    <div className="deltas">
      {part(d.leadMin, num(Math.abs(d.leadMin)), 'min lead')}
      {part(d.costPerUnit, money(Math.abs(d.costPerUnit)), 'a unit')}
      {part(d.buildCost, money(Math.abs(d.buildCost)), 'build')}
      {part(d.uph, num(Math.abs(d.uph)), 'an hour', false)}
    </div>
  );
}

function CompareModal({ versions, a, b, models, onPick, onClose }: { versions: Version[]; a: Version; b: Version; models?: Project['models']; onPick: (k: 'a' | 'b', id: string) => void; onClose: () => void }) {
  const rows = compare(a.metrics, b.metrics);
  const evA = useMemo(() => evaluate(a.spec, 2), [a]);
  const evB = useMemo(() => evaluate(b.spec, 2), [b]);
  const layers: Layers = { flow: true, routes: false, power: false, water: false, labels: false, crew: false };
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="compare" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compare versions">
        <header>
          <h2>
            {a.id} against {b.id}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="compare-views">
          {(
            [
              ['a', a, evA],
              ['b', b, evB],
            ] as const
          ).map(([k, v, ev]) => (
            <div key={k} className="compare-view">
              <select value={v.id} onChange={(e) => onPick(k, e.target.value)} aria-label={k === 'a' ? 'First version' : 'Second version'}>
                {versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id} · {x.label}
                  </option>
                ))}
              </select>
              <Scene spec={v.spec} routes={ev.ok ? ev.routes : null} layers={layers} models={models} interactive={false} animate={false} />
            </div>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th />
              <th>{a.id}</th>
              <th>{b.id}</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{r.unit === '$' ? money(r.a) : `${num(r.a, 2)} ${r.unit}`}</td>
                <td>{r.unit === '$' ? money(r.b) : `${num(r.b, 2)} ${r.unit}`}</td>
                {(() => {
                  const shown = r.unit === '$' ? money(Math.abs(r.delta)) : num(Math.abs(r.delta), 2);
                  const zero = !/[1-9]/.test(shown);
                  return (
                    <td className={zero || r.better === null ? 'muted' : r.better ? 'good' : 'warn'}>
                      {zero ? '' : r.delta > 0 ? '+' : '−'}
                      {shown}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          What changed in {b.id}: {b.diff.join('; ') || 'nothing'}.
        </p>
      </div>
    </div>
  );
}

export function Workspace({ project, onHome, onPlan, onChange }: { project: Project; onHome: () => void; onPlan: () => void; onChange: (patch: Partial<Project>) => void }) {
  const versions = project.versions;
  const current = versions.find((v) => v.id === project.currentId) ?? versions[versions.length - 1];
  // draft is always a validated spec; preview is whatever is under the cursor mid-drag
  const [draft, setDraft] = useState<FactorySpec>(current.spec);
  const [preview, setPreview] = useState<FactorySpec | null>(null);
  const [rejected, setRejected] = useState<ValidationError[]>([]);
  const [layers, setLayers] = useState<Layers>({ flow: true, routes: false, power: false, water: false, labels: true, crew: true });
  const [tab, setTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; title: string; lines: string[] } | null>(null);
  const [command, setCommand] = useState('');
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState<'audit' | 'fix' | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);

  // Evals: the crew's report (null until Run evals is clicked), what each of them is doing meanwhile, fixes, voice
  const [serverAudit, setServerAudit] = useState<AdvocateReport | null>(null);
  const [crewLive, setCrewLive] = useState<CrewLive>({});
  const keepAudit = useRef<{ id: string; report: AdvocateReport } | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  // checkouts the browser would not open in a window: shown as a link in the row instead
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [roleFilter, setRoleFilter] = useState<AdvocateRole | 'all'>('all');
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [fixProposal, setFixProposal] = useState<FixProposal | null>(null);
  const [speech, setSpeech] = useState<ActiveSpeech | null>(null);
  const [muted, setMuted] = useState(false);
  const [walkthroughIdx, setWalkthroughIdx] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechTokenRef = useRef(0);
  const walkTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recorder = useRef<Recorder | null>(null);
  const run = useRun();
  const busy = run.busy;
  const narrow = useNarrow();
  // ?capture: the floor alone, centred, for saving a clean picture of it
  const capture = new URLSearchParams(location.search).has('capture');

  useEffect(() => {
    setDraft(current.spec);
    setRejected([]);
    // a fix saved as a new version brings its remaining findings with it; any other version starts with no evals
    setServerAudit(keepAudit.current?.id === current.id ? keepAudit.current.report : null);
    keepAudit.current = null;
    setFixProposal(null);
  }, [current.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any audio / timers cleanly on unmount
  const stopAudio = useCallback(() => {
    speechTokenRef.current++;
    clearTimeout(walkTimerRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  // thirty simulated shifts on a workshop; ten on a plant, where each one is far more work
  const evaluation = useMemo(() => evaluate(draft, draft.stations.length > 40 ? 10 : 30), [draft]);
  const previewErrors = useMemo(() => (preview ? validate(preview) : []), [preview]);
  const metrics = evaluation.ok ? evaluation.metrics : current.metrics;
  const sim = metrics.sim;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.spec);

  // The crew is only on the floor once evals have been run on this layout.
  const activeAudit = fixProposal ? fixProposal.postAudit : serverAudit;
  const shown = preview ?? fixProposal?.spec ?? draft;
  const shownEval = useMemo(() => (fixProposal ? evaluate(fixProposal.spec, 12) : evaluation), [fixProposal, evaluation]);
  const shownRoutes = !preview && shownEval.ok ? shownEval.routes : null;

  const v1 = versions[0];
  const nextN = Math.max(...versions.map((v) => v.n)) + 1;
  const hot = sim.bottleneck.utilisation >= 0.85;

  const findings = activeAudit?.findings ?? [];
  const filteredFindings = useMemo(
    () => (roleFilter === 'all' ? findings : findings.filter((f) => f.role === roleFilter)),
    [findings, roleFilter],
  );
  const activeFinding = findings.find((f) => f.id === activeFindingId) ?? null;

  // Highlighted stations on the 3D floor for the selected finding or proposed fix
  const highlightedIds = useMemo(() => {
    if (fixProposal) {
      const ids = fixProposal.ops
        .map((o) => ('id' in o ? o.id : o.op === 'add' ? o.station.id : null))
        .filter((x): x is string => Boolean(x));
      return ids;
    }
    if (activeFinding) return activeFinding.targetIds;
    return [];
  }, [fixProposal, activeFinding]);

  const activeRole: CharacterRole | null = fixProposal
    ? 'fixer'
    : speech?.role ?? activeFinding?.role ?? (roleFilter !== 'all' ? roleFilter : null);
  const speakingRole: CharacterRole | null = speech && (speech.playing || speech.loading) ? speech.role : null;

  const evalRunning = run.busy && mode === 'audit';
  // While the evals run each technician walks to the machine their trade cares most about; afterwards, to what they found.
  const crewPlans = useMemo(() => {
    if (activeAudit) return activeAudit.walkPlans;
    if (evalRunning && evaluation.ok) return computeCharacterWalkPlans(draft, [], undefined, crewStartTargets(draft, evaluation.metrics));
    return [];
  }, [activeAudit, evalRunning, draft, evaluation]);
  // The note over each technician's head: what they are doing, then what they found.
  const bubbles = useMemo(() => {
    const out: Partial<Record<CharacterRole, CrewBubble>> = {};
    if (evalRunning) {
      for (const role of ADVOCATE_ROLES) {
        const st = crewLive[role];
        out[role] = !st || st.state === 'writing' ? { text: 'writing', tone: 'writing' } : st.state === 'failed' ? { text: 'Could not finish', tone: 'clear' } : { text: st.top ?? 'Nothing found', tone: st.top ? 'warning' : 'clear' };
      }
      return out;
    }
    if (!activeAudit) return out;
    for (const role of ADVOCATE_ROLES) {
      const mine = findings.filter((f) => f.role === role);
      const focus = activeFinding?.role === role ? activeFinding : mine[0];
      out[role] = focus ? { text: mine.length > 1 && focus.id !== activeFindingId ? `${mine.length} issues. ${focus.title}` : focus.title, tone: focus.severity } : { text: 'Nothing found', tone: 'clear' };
    }
    if (fixProposal) out.fixer = { text: fixProposal.summary.split(' — ')[0], tone: 'clear' };
    return out;
  }, [evalRunning, crewLive, activeAudit, findings, activeFinding, activeFindingId, fixProposal]);

  /** Speak a line as one of the 6 3D floor characters via Gemini 3.8 TTS (/api/advocate/speak). */
  const speakAs = useCallback(
    async (role: CharacterRole, text: string, targetLabel: string, findingId?: string, onFinished?: () => void) => {
      stopAudio();
      const token = ++speechTokenRef.current;
      setLayers((l) => (l.crew ? l : { ...l, crew: true }));
      setSpeech({ role, targetLabel, text, findingId, loading: !muted, playing: muted });

      if (muted) {
        if (onFinished) {
          walkTimerRef.current = setTimeout(() => {
            if (speechTokenRef.current === token) onFinished();
          }, 4200);
        }
        return;
      }

      try {
        const res = await api<{ audioBase64: string; mimeType: string }>('/api/advocate/speak', { role, text });
        if (speechTokenRef.current !== token) return;
        const audio = new Audio(`data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}`);
        audioRef.current = audio;
        audio.onended = () => {
          if (speechTokenRef.current !== token) return;
          setSpeech((cur) => (cur ? { ...cur, playing: false, loading: false } : null));
          if (onFinished) {
            walkTimerRef.current = setTimeout(() => {
              if (speechTokenRef.current === token) onFinished();
            }, 650);
          }
        };
        audio.onerror = () => {
          if (speechTokenRef.current !== token) return;
          setSpeech((cur) => (cur ? { ...cur, playing: false, loading: false, error: 'Browser blocked audio playback; reading caption instead.' } : null));
        };
        setSpeech({ role, targetLabel, text, findingId, loading: false, playing: true });
        await audio.play().catch(() => {
          if (speechTokenRef.current !== token) return;
          setSpeech((cur) => (cur ? { ...cur, playing: false, loading: false, error: 'Click play to enable browser audio.' } : null));
        });
      } catch (e) {
        if (speechTokenRef.current !== token) return;
        setSpeech({
          role,
          targetLabel,
          text,
          findingId,
          loading: false,
          playing: false,
          error: (e as Error).message,
        });
        if (onFinished) {
          walkTimerRef.current = setTimeout(() => {
            if (speechTokenRef.current === token) onFinished();
          }, 4000);
        }
      }
    },
    [muted, stopAudio],
  );

  const hearFinding = useCallback(
    (f: AdvocateFinding, onFinished?: () => void) => {
      setActiveFindingId(f.id);
      if (f.targetIds[0]) setSelected(f.targetIds[0]);
      const target = f.targetIds.length ? f.targetIds.join(', ') : 'Floor';
      void speakAs(f.role, f.spokenLine, target, f.id, onFinished);
    },
    [speakAs],
  );

  // Guided multi-character floor walkthrough
  const startWalkthroughAt = useCallback(
    (idx: number) => {
      if (!findings.length || idx < 0 || idx >= findings.length) {
        setWalkthroughIdx(null);
        return;
      }
      setWalkthroughIdx(idx);
      const f = findings[idx];
      hearFinding(f, () => {
        if (idx + 1 < findings.length) startWalkthroughAt(idx + 1);
        else setWalkthroughIdx(null);
      });
    },
    [findings, hearFinding],
  );

  const stopWalkthrough = useCallback(() => {
    setWalkthroughIdx(null);
    stopAudio();
    setSpeech(null);
  }, [stopAudio]);

  const handleSelectCharacter = useCallback(
    (role: CharacterRole) => {
      setTab('evals');
      if (role === 'fixer' && fixProposal) {
        void speakAs('fixer', fixProposal.spokenSummary, 'Proposed fix');
        return;
      }
      const match = findings.find((f) => f.role === role);
      if (match) {
        setWalkthroughIdx(null);
        hearFinding(match);
      } else {
        const char = ADVOCATE_CHARACTERS[role];
        void speakAs(role, `${char.title}: nothing found on this floor.`, 'Nothing found');
      }
    },
    [findings, fixProposal, hearFinding, speakAs],
  );

  /** Run a streamed harness call; its steps land in the tracker live and in the project's run log after. */
  const call = async <T,>(label: string, path: string, body: unknown, tap?: (e: TraceEvent) => void): Promise<T | null> => {
    setNotice(null);
    let events: TraceEvent[] = [];
    try {
      const out = await run.run(label, (onEvent) =>
        apiStream<T>(path, body, (e) => {
          tap?.(e);
          onEvent(e);
        }),
      );
      events = out.events;
      return out.value;
    } catch (e) {
      const err = e as ApiError;
      setNotice({ tone: 'error', title: err.message, lines: err.lines ?? [] });
      return null;
    } finally {
      if (events.length) onChange({ trace: [...project.trace, ...events] });
    }
  };

  /** Every manual edit goes through here: apply the op, validate, accept or reject with the reasons. */
  const tryOp = (op: EditOp) => {
    let next: FactorySpec;
    try {
      next = applyOp(draft, op);
    } catch (e) {
      return void setRejected([{ code: 'param', message: (e as Error).message, ids: [] }]);
    }
    const errs = validate(next);
    if (errs.length) setRejected(errs);
    else {
      setRejected([]);
      setServerAudit(null);
      setFixProposal(null);
      setDraft(next);
    }
  };
  const onDrag = (id: string, x: number, y: number) => setPreview(applyOp(preview ?? draft, { op: 'move', id, x, y }));
  const onDrop = () => {
    if (preview) {
      if (previewErrors.length) setRejected(previewErrors);
      else {
        setRejected([]);
        setServerAudit(null);
        setFixProposal(null);
        setDraft(preview);
      }
    }
    setPreview(null);
  };

  const save = () => {
    if (!evaluation.ok || !dirty) return;
    const v = makeVersion(draft, evaluation.metrics, current, nextN, 'Edited by hand');
    onChange({ versions: [...versions, v], currentId: v.id });
  };

  const sendEdit = async (payload: { text?: string; audio?: { mimeType: string; data: string } }) => {
    const out = await call<{ ops: EditOp[]; spec: FactorySpec; transcript: string; reason: string }>(payload.audio ? 'Listening' : 'Planning the edit', '/api/edit', { spec: draft, ...payload });
    if (!out) return;
    if (!out.ops.length) return void setNotice({ tone: 'error', title: `Nothing changed for “${out.transcript}”`, lines: [out.reason] });
    setDraft(out.spec);
    setServerAudit(null);
    setFixProposal(null);
    setRejected([]);
    setCommand('');
    setNotice({ tone: 'ok', title: `“${out.transcript}”`, lines: out.ops.map(describeOp) });
  };

  const toggleMic = async () => {
    if (recording && recorder.current) {
      setRecording(false);
      const rec = recorder.current;
      recorder.current = null;
      try {
        await sendEdit({ audio: await rec.stop() });
      } catch (e) {
        setNotice({ tone: 'error', title: 'Could not process the recording', lines: [(e as Error).message] });
      }
      return;
    }
    try {
      recorder.current = await startRecording();
      setRecording(true);
    } catch (e) {
      setNotice({ tone: 'error', title: 'Microphone unavailable', lines: [(e as Error).message] });
    }
  };

  /** Run evals: deploy the crew. Five technician agents inspect the floor; a checker filters what they write. */
  const runEvals = async () => {
    setTab('evals');
    setMode('audit');
    setFixProposal(null);
    setServerAudit(null);
    setActiveFindingId(null);
    setCrewLive({});
    setLayers((l) => ({ ...l, crew: true }));
    const out = await call<AdvocateReport>('Technicians inspecting the floor', '/api/advocate/audit', { spec: draft, requirements: project.requirements }, (e) => {
      if (!e.who) return;
      const role = e.who as AdvocateRole;
      const rest = e.title.slice(ADVOCATE_CHARACTERS[role]?.name.length ?? 0).replace(/^[:\s]+(is )?/, '');
      setCrewLive((cur) => ({ ...cur, [role]: e.status === 'running' ? { state: 'writing', text: rest } : e.status === 'fail' && e.actor === 'neon' ? { state: 'failed', text: 'could not finish' } : { state: 'done', text: rest, top: e.detail } }));
    });
    setMode(null);
    if (!out) return;
    setServerAudit(out);
  };

  /** Technician findings cannot be re-measured, so they are carried across a fix unless the fix clears them. */
  const carried = (cleared: string[]) => (activeAudit?.findings ?? []).filter((f) => f.source === 'gemini' && !cleared.includes(f.id));

  /** A layout fix for measured findings or machines a technician wants moved: drafted, validated and simulated on the server. */
  const requestFix = async (targetList: AdvocateFinding[]) => {
    if (!targetList.length) return;
    setMode('fix');
    setWalkthroughIdx(null);
    const out = await call<FixProposal>('Drafting a layout fix', '/api/advocate/fix', { spec: draft, findings: targetList, requirements: project.requirements });
    setMode(null);
    if (!out) return;
    const merged = buildReport(out.spec, [...out.postAudit.findings, ...carried(out.resolvedIds ?? [])], 'full');
    const fixerAt = out.postAudit.walkPlans.find((p) => p.role === 'fixer')?.targetId;
    merged.walkPlans = computeCharacterWalkPlans(out.spec, merged.findings, fixerAt ? [fixerAt] : undefined);
    setFixProposal({ ...out, postAudit: merged, remainingBlockers: merged.blockerCount, remainingWarnings: merged.warningCount });
  };

  /** Add the equipment findings say is missing. Code finds each unit a legal spot beside the machine it serves. */
  const previewEquipment = (list: AdvocateFinding[]) => {
    if (!evaluation.ok) return;
    let next = draft;
    const ops: EditOp[] = [];
    const cleared: string[] = [];
    const names: string[] = [];
    for (const f of list) {
      const added = addSupportEquipment(next, f);
      if (!added) continue;
      next = added.spec;
      ops.push(...added.ops);
      cleared.push(f.id);
      names.push(added.station.name ?? added.station.type);
    }
    if (!ops.length) return void setNotice({ tone: 'error', title: 'No room on the floor for that equipment', lines: ['Free some floor space or widen the floor, then try again.'] });
    // same number of simulated shifts as the layout it is compared with, so the difference is the equipment and not the sampling
    const ev = evaluate(next, next.stations.length > 40 ? 10 : 30);
    if (!ev.ok) return void setNotice({ tone: 'error', title: 'Adding that equipment breaks a layout rule', lines: ev.errors.map((e) => e.message) });
    const rows = Object.fromEntries(compare(evaluation.metrics, ev.metrics).map((r) => [r.key, r.delta]));
    const measured = runDeterministicAdvocateAudit(next, ev.metrics, ev.routes, project.requirements).findings;
    const post = buildReport(next, [...measured, ...carried(cleared)], 'full');
    const summary = names.length === 1 ? `Add ${names[0]}` : `Add ${names.length} units: ${names.join(', ')}`;
    setWalkthroughIdx(null);
    setFixProposal({
      id: `equip-${Date.now()}`,
      targetFindingIds: cleared,
      summary,
      spokenSummary: `${summary}. Placed beside the machine it serves.`,
      ops,
      spec: next,
      deltas: { uph: rows.uph, leadMin: rows.lead, costPerUnit: rows.cpu, buildCost: rows.build },
      resolvedCount: cleared.length,
      resolvedIds: cleared,
      remainingBlockers: post.blockerCount,
      remainingWarnings: post.warningCount,
      postAudit: post,
      source: 'deterministic',
      ms: 0,
    });
  };

  /** A design or procedure change is the user's to sign off: marking it done takes it off the list. */
  const markDone = (f: AdvocateFinding) => {
    if (!serverAudit || fixProposal) return;
    setServerAudit(buildReport(draft, serverAudit.findings.filter((x) => x.id !== f.id), serverAudit.mode));
  };

  const applyFixProposal = () => {
    if (!fixProposal) return;
    const ev = evaluate(fixProposal.spec);
    if (!ev.ok) {
      setRejected(ev.errors);
      return;
    }
    const v = makeVersion(fixProposal.spec, ev.metrics, current, nextN, `Fixer: ${fixProposal.summary.split(' — ')[0]}`);
    stopAudio();
    setSpeech(null);
    keepAudit.current = { id: v.id, report: fixProposal.postAudit };
    setDraft(fixProposal.spec);
    setServerAudit(fixProposal.postAudit);
    setFixProposal(null);
    setRejected([]);
    onChange({ versions: [...versions, v], currentId: v.id });
    setNotice({
      tone: 'ok',
      title: `Saved the fix as ${v.id}`,
      lines: [
        fixProposal.resolvedCount > 0
          ? `Resolved ${fixProposal.resolvedCount} issue${fixProposal.resolvedCount === 1 ? '' : 's'} · ${fixProposal.remainingBlockers} blocker${fixProposal.remainingBlockers === 1 ? '' : 's'} remaining.`
          : `Saved verified layout update · ${fixProposal.remainingBlockers} blocker${fixProposal.remainingBlockers === 1 ? '' : 's'} remaining.`,
      ],
    });
  };

  const liveErrors = preview ? previewErrors : rejected;
  const sel = selected ? shown.stations.find((s) => s.id === selected) : null;
  const dLead = (v1.metrics.sim.leadTimeSec.median - sim.leadTimeSec.median) / 60;
  const dUnit = v1.metrics.cost.costPerUnit - metrics.cost.costPerUnit;
  const dBuild = v1.metrics.cost.buildCost - metrics.cost.buildCost;
  const versus = (v: number, f: (x: number) => string) => (
    <b className={Math.abs(v) < 1e-9 ? '' : v > 0 ? 'good' : 'warn'}>
      {f(Math.abs(v))} {v >= 0 ? 'less' : 'more'}
    </b>
  );
  const bill = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; price: number; checkoutUrl?: string; listingUrl?: string }>();
    for (const s of draft.stations) {
      const key = s.catalogId ?? s.type;
      const row = map.get(key) ?? { name: s.name ?? s.type, qty: 0, price: s.price, checkoutUrl: s.checkoutUrl, listingUrl: s.listingUrl };
      row.qty++;
      map.set(key, row);
    }
    return [...map.values()];
  }, [draft]);
  /**
   * Buy: straight to the seller's checkout, where payment is approved. The window is opened inside the
   * click (browsers block it otherwise) and pointed at the checkout as soon as Shop has created it.
   */
  const buy = async (r: { name: string; qty: number; checkoutUrl?: string }) => {
    if (!r.checkoutUrl) return;
    const w = Math.min(520, window.screen.availWidth);
    const h = Math.min(820, window.screen.availHeight);
    const popup = window.open('', 'dryrun-checkout', `popup=yes,width=${w},height=${h},left=${Math.round(window.screenX + (window.outerWidth - w) / 2)},top=${Math.round(window.screenY + (window.outerHeight - h) / 2)}`);
    if (popup) {
      popup.document.title = 'Checkout';
      popup.document.body.style.cssText = 'margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#26282a;background:#faf6ee;text-align:center;padding:24px;box-sizing:border-box';
      popup.document.body.textContent = `Opening secure checkout for ${r.qty} × ${r.name}…`;
    }
    setBuying(r.checkoutUrl);
    try {
      const out = await api<{ url: string }>('/api/shop/checkout', { buyUrl: r.checkoutUrl, quantity: r.qty });
      if (popup && !popup.closed) popup.location.replace(out.url);
      else if (!window.open(out.url, '_blank')) setBlocked((cur) => ({ ...cur, [r.checkoutUrl as string]: out.url }));
    } catch (e) {
      popup?.close();
      setNotice({ tone: 'error', title: 'Could not open the checkout', lines: [(e as Error).message] });
    } finally {
      setBuying(null);
    }
  };
  const cmpA = cmp && versions.find((v) => v.id === cmp.a);
  const cmpB = cmp && versions.find((v) => v.id === cmp.b);
  const outcomeIcon = { kept: 'check', simulated: 'minus', 'gated out': 'minus', rejected: 'x', vetoed: 'shield' } as const;

  const totalOpenFindings = findings.filter((f) => f.severity !== 'advisory').length;
  const missingUnits = findings.filter((f) => fixKind(f) === 'equipment');
  const layoutIssues = findings.filter((f) => fixKind(f) === 'layout' && f.severity !== 'advisory');

  return (
    <div className={`page workspace${capture ? ' capture' : ''}`}>
      <TopBar
        onHome={onHome}
        log={project.trace}
        crumbs={[{ label: 'Brief' }, { label: 'Equipment', onClick: onPlan }, { label: 'Simulation', active: true }]}
        right={
          <a href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval
          </a>
        }
      />
      <div className="stage">
        <Scene
          spec={shown}
          routes={shownRoutes}
          layers={layers}
          models={project.models}
          badIds={previewErrors.flatMap((e) => e.ids)}
          highlightedIds={highlightedIds}
          bottleneck={hot ? sim.bottleneck.name : undefined}
          selectedId={selected}
          walkPlans={crewPlans}
          bubbles={bubbles}
          activeRole={activeRole}
          speakingRole={speakingRole}
          insetRight={narrow || capture ? 0 : PANEL + 14}
          onSelect={setSelected}
          onSelectCharacter={handleSelectCharacter}
          onDrag={onDrag}
          onDrop={onDrop}
        />
      </div>

      <div className="stage-title">
        <h1>{project.name}</h1>
        <p>
          {current.id}
          {fixProposal ? ' · previewing fix' : dirty ? ', with unsaved changes' : ''} · {draft.floor.width} × {draft.floor.depth} m · {draft.stations.length} stations{draft.transport === 'conveyor' ? ' · conveyors' : ''}
        </p>
      </div>

      <div className="layerbar" role="group" aria-label="Show on the floor">
        {(
          [
            ['flow', 'Flow'],
            ['routes', 'Routes'],
            ['power', 'Power'],
            ['water', 'Water'],
            ['labels', 'Labels'],
            ['crew', 'Crew'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={layers[k] ? 'on' : ''} aria-pressed={Boolean(layers[k])} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}>
            {label}
          </button>
        ))}
      </div>

      <aside className="panel" style={narrow ? undefined : { width: PANEL }}>
        <nav className="tabs" role="tablist">
          {(['overview', 'evals', 'equipment', 'versions'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'evals' && totalOpenFindings > 0 && <em>{totalOpenFindings}</em>}
              {t === 'versions' && <em>{versions.length}</em>}
            </button>
          ))}
        </nav>

        <div className="panel-body">
          {tab === 'overview' && (
            <>
              <div className="section">
                <div className="stats">
                  <Stat
                    label="Throughput"
                    value={num(sim.unitsPerHour.median)}
                    unit="an hour"
                    sub={sim.unitsPerHour.median < draft.demandPerHour * 0.97 ? `${num(draft.demandPerHour - sim.unitsPerHour.median)} short of demand` : `demand is ${draft.demandPerHour}`}
                    tone={sim.unitsPerHour.median < draft.demandPerHour * 0.97 ? 'warn' : undefined}
                  />
                  <Stat label="Lead time" value={num(sim.leadTimeSec.median / 60)} unit="min" sub={`${num(sim.wip.median)} units in progress`} />
                  <Stat label="Cost per unit" value={money(metrics.cost.costPerUnit)} sub={`${num(metrics.cost.kwhPerUnit, 2)} kWh a unit`} />
                  <Stat label="Build cost" value={money(metrics.cost.buildCost)} sub={metrics.cost.conveyorCost ? `${money(metrics.cost.conveyorCost)} of it is conveyor` : `${money(metrics.cost.utilityRunCost)} is power and water runs`} />
                </div>
                {(versions.length > 1 || dirty) && (
                  <p className="say">
                    Against v1: lead time {versus(dLead, (x) => `${num(x)} min`)}, cost per unit {versus(dUnit, money)}, build cost {versus(dBuild, money)}.
                  </p>
                )}
              </div>
              <div className="section">
                <div className="adv-head">
                  <h3>Evals</h3>
                  {activeAudit && (
                    <span className={`adv-verdict ${activeAudit.verdict}`}>
                      {activeAudit.blockerCount > 0
                        ? `${activeAudit.blockerCount} blocker${activeAudit.blockerCount > 1 ? 's' : ''}`
                        : activeAudit.warningCount > 0
                          ? `${activeAudit.warningCount} warning${activeAudit.warningCount > 1 ? 's' : ''}`
                          : 'Nothing found'}
                    </span>
                  )}
                </div>
                {activeAudit ? (
                  <>
                    <p className="say">{activeAudit.summary}</p>
                    <div className="row">
                      <button className="ghost sm" onClick={() => setTab('evals')}>
                        <Icon name="shield" size={14} /> Open evals
                      </button>
                    </div>
                  </>
                ) : evalRunning ? (
                  <p className="say">
                    <span className="spinner ink" /> The crew is on the floor.
                  </p>
                ) : (
                  <>
                    <p className="say">Not run on this layout.</p>
                    <div className="row">
                      <button className="primary sm" disabled={busy} onClick={() => void runEvals()}>
                        <Icon name="shield" size={14} /> Run evals
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="section">
                <h3>How busy each step is</h3>
                <div className="utils">
                  {Object.entries(sim.utilisation).map(([name, u]) => (
                    <div key={name} className="util">
                      <span>{name}</span>
                      <div className="bar">
                        <i style={{ width: `${Math.min(100, u * 100)}%` }} className={u >= 0.85 ? 'hot' : ''} />
                      </div>
                      <em>{num(u * 100, 0)}%</em>
                    </div>
                  ))}
                </div>
                {hot && (
                  <p className="say">
                    <b className="warn">{sim.bottleneck.name === 'forklift' ? 'The forklift' : sim.bottleneck.name[0].toUpperCase() + sim.bottleneck.name.slice(1)}</b> is the bottleneck
                    {sim.bottleneck.name === 'forklift' ? `: it carries each unit ${num(metrics.routeTotals.forkliftM, 0)} m.` : '.'}
                  </p>
                )}
              </div>
              <div className="section">
                <h3>What if</h3>
                <label className="slider">
                  <span>
                    Demand <b>{draft.demandPerHour} an hour</b>
                  </span>
                  <input type="range" min={5} max={Math.max(80, current.spec.demandPerHour * 2)} step={1} value={draft.demandPerHour} onChange={(e) => tryOp({ op: 'setParam', path: 'demandPerHour', value: Number(e.target.value) })} />
                </label>
                <label className="slider" style={draft.transport === 'conveyor' ? { display: 'none' } : undefined}>
                  <span>
                    Forklifts <b>{draft.forklifts ?? 1}</b>
                  </span>
                  <input type="range" min={1} max={4} step={1} value={draft.forklifts ?? 1} onChange={(e) => tryOp({ op: 'setParam', path: 'forklifts', value: Number(e.target.value) })} />
                </label>
              </div>
              {sel && (
                <div className="section">
                  <h3>Selected</h3>
                  <p className="say">
                    <b>{sel.name ?? sel.type}</b>
                    <br />
                    {sel.w} × {sel.d} m · {sel.cycleTimeSec} s a unit · {money(sel.price)}
                    {sel.listingUrl && (
                      <>
                        {' · '}
                        <a href={sel.listingUrl} target="_blank" rel="noreferrer">
                          listing
                        </a>
                      </>
                    )}
                  </p>
                  <div className="row">
                    <button className="ghost sm" onClick={() => tryOp({ op: 'rotate', id: sel.id, rot: sel.rot === 0 ? 90 : 0 })}>
                      <Icon name="rotate" size={14} /> Turn
                    </button>
                    <button
                      className="ghost sm"
                      onClick={() => {
                        tryOp({ op: 'remove', id: sel.id });
                        setSelected(null);
                      }}
                    >
                      <Icon name="trash" size={14} /> Remove
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'evals' && (
            <>
              {!activeAudit && !evalRunning && (
                <div className="section evals-empty">
                  <h3>Evals</h3>
                  <p className="say">Five technicians inspect every machine and list what to fix.</p>
                  <div className="row">
                    <button className="primary" disabled={busy} onClick={() => void runEvals()}>
                      <Icon name="shield" size={15} /> Run evals
                    </button>
                  </div>
                </div>
              )}

              {evalRunning && (
                <div className="section">
                  <h3>The crew is on the floor</h3>
                  <div className="crew-list">
                    {ADVOCATE_ROLES.map((role) => {
                      const c = ADVOCATE_CHARACTERS[role];
                      const st = crewLive[role];
                      return (
                        <div key={role} className={`crew-row ${st?.state ?? 'writing'}`}>
                          <span className="adv-dot" style={{ background: c.accent }} />
                          <div>
                            <b>{c.name}</b>
                            <span>{c.title}</span>
                          </div>
                          <span className="crew-state">
                            {!st || st.state === 'writing' ? (
                              <>
                                <span className="spinner ink" /> {st?.text || 'walking over'}
                              </>
                            ) : (
                              st.text
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted small">{run.live ?? 'Working'}</p>
                </div>
              )}

              {busy && mode === 'fix' && (
                <div className="section">
                  <div className="live">
                    <span className="spinner ink" />
                    {run.live ?? 'Working'}
                  </div>
                </div>
              )}

              {/* A fix, previewed on the floor before it is saved */}
              {!busy && fixProposal && (
                <div className="section fix-preview">
                  <div className="fix-preview-head">
                    <b>
                      <span className="adv-dot" style={{ background: ADVOCATE_CHARACTERS.fixer.accent }} />
                      Proposed fix
                    </b>
                    <button className="text sm" onClick={() => void speakAs('fixer', fixProposal.spokenSummary, 'Proposed fix')}>
                      <Icon name="volume" size={14} /> Hear
                    </button>
                  </div>
                  <p className="say">{fixProposal.summary}</p>
                  <DeltaLine d={fixProposal.deltas} />
                  <p className="muted small num">
                    Resolves {fixProposal.resolvedCount} finding{fixProposal.resolvedCount === 1 ? '' : 's'} · {fixProposal.remainingBlockers} blocker{fixProposal.remainingBlockers === 1 ? '' : 's'} and {fixProposal.remainingWarnings} warning{fixProposal.remainingWarnings === 1 ? '' : 's'} remaining
                  </p>
                  <ul className="fix-ops">
                    {fixProposal.ops.slice(0, 5).map((op, i) => (
                      <li key={i}>{describeOp(op)}</li>
                    ))}
                  </ul>
                  <div className="row">
                    <button className="primary sm" onClick={applyFixProposal}>
                      <Icon name="check" size={14} /> Apply & save as v{nextN}
                    </button>
                    <button
                      className="ghost sm"
                      onClick={() => {
                        setFixProposal(null);
                        stopAudio();
                        setSpeech(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}


              {activeAudit && !evalRunning && (
                <div className="section">
                  <div className="adv-head">
                    <h3>Evals</h3>
                    <span className={`adv-verdict ${activeAudit.verdict}`}>
                      {activeAudit.blockerCount} blocker{activeAudit.blockerCount === 1 ? '' : 's'} · {activeAudit.warningCount} warning{activeAudit.warningCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="row">
                    {missingUnits.length > 0 && (
                      <button className="primary sm" disabled={busy || !!fixProposal} onClick={() => previewEquipment(missingUnits)}>
                        <Icon name="plus" size={13} /> Add {missingUnits.length} unit{missingUnits.length === 1 ? '' : 's'}
                      </button>
                    )}
                    {layoutIssues.length > 0 && (
                      <button className="ghost sm" disabled={busy || !!fixProposal} onClick={() => void requestFix(layoutIssues)}>
                        <Icon name="wrench" size={13} /> Fix layout ({layoutIssues.length})
                      </button>
                    )}
                    <button className="text sm" disabled={busy} onClick={() => void runEvals()}>
                      Run again
                    </button>
                  </div>

                  <div className="adv-crew" role="group" aria-label="Filter by technician">
                    <button className={`adv-crew-btn${roleFilter === 'all' ? ' on' : ''}`} onClick={() => setRoleFilter('all')}>
                      All <em>{findings.length}</em>
                    </button>
                    {ADVOCATE_ROLES.map((role) => {
                      const char = ADVOCATE_CHARACTERS[role];
                      const count = findings.filter((f) => f.role === role).length;
                      return (
                        <button
                          key={role}
                          className={`adv-crew-btn${roleFilter === role ? ' on' : ''}`}
                          onClick={() => {
                            setRoleFilter(roleFilter === role ? 'all' : role);
                            const first = findings.find((f) => f.role === role);
                            if (first) setActiveFindingId(first.id);
                          }}
                          title={`${char.name}, ${char.title.toLowerCase()}`}
                        >
                          <span className="adv-dot" style={{ background: char.accent }} />
                          {char.shortTitle} <em>{count}</em>
                        </button>
                      );
                    })}
                  </div>

                  <div className="adv-list">
                    {filteredFindings.length === 0 ? (
                      <p className="muted small">{roleFilter === 'all' ? 'Nothing found.' : `${ADVOCATE_CHARACTERS[roleFilter].name} found nothing.`}</p>
                    ) : (
                      filteredFindings.map((f) => {
                        const char = ADVOCATE_CHARACTERS[f.role];
                        const kind = fixKind(f);
                        const open = activeFindingId === f.id;
                        const locked = busy || !!fixProposal;
                        return (
                          <div
                            key={f.id}
                            className={`ev-row${open ? ' open' : ''}`}
                            onClick={() => {
                              setActiveFindingId(open ? null : f.id);
                              if (f.targetIds[0]) setSelected(f.targetIds[0]);
                            }}
                          >
                            <span className={`ev-sev ${f.severity}`} title={f.severity === 'advisory' ? 'note' : f.severity} />
                            <div className="ev-main">
                              <div className="ev-title">{f.title}</div>
                              <div className="ev-sub">
                                {f.targetIds.length ? f.targetIds.join(', ') : 'Plant'} · {char.shortTitle} · {proof(f)}
                              </div>
                              {open && (
                                <>
                                  <p className="ev-why">{f.evidence}</p>
                                  <p className="ev-fix">
                                    <b>Fix</b> {f.action ?? f.suggestedFixHint}
                                  </p>
                                </>
                              )}
                            </div>
                            <div className="ev-act" onClick={(e) => e.stopPropagation()}>
                              {kind === 'equipment' && f.fix?.kind === 'equipment' && (
                                <button className="ghost sm" disabled={locked} onClick={() => previewEquipment([f])} title={`Place ${f.fix.equipment.name} on the floor`}>
                                  Add{f.fix.equipment.price ? ` ${shortPrice(f.fix.equipment.price)}` : ''}
                                </button>
                              )}
                              {kind === 'layout' && (
                                <button className="ghost sm" disabled={locked} onClick={() => void requestFix([f])} title="Draft a layout fix and simulate it">
                                  Fix
                                </button>
                              )}
                              {kind === 'spec' && (
                                <button className="ghost sm" disabled={locked} onClick={() => markDone(f)} title="A design change: tick it off once it is in the spec">
                                  Done
                                </button>
                              )}
                              {open && (
                                <button
                                  className="icon-btn"
                                  title="Read aloud"
                                  aria-label="Read this finding aloud"
                                  onClick={() => {
                                    setWalkthroughIdx(null);
                                    hearFinding(f);
                                  }}
                                >
                                  <Icon name="volume" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'equipment' && (
            <div className="section">
              {bill.map((r, i) => (
                <div key={i} className="bill-row">
                  <span>
                    {r.qty} ×{' '}
                    {r.listingUrl ? (
                      <a href={r.listingUrl} target="_blank" rel="noreferrer" title="Open the listing">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </span>
                  <span>{money(r.qty * r.price)}</span>
                  {r.checkoutUrl && blocked[r.checkoutUrl] ? (
                    <a className="small" href={blocked[r.checkoutUrl]} target="_blank" rel="noreferrer" title="Your browser blocked the checkout window">
                      Open checkout
                    </a>
                  ) : r.checkoutUrl ? (
                    <button className="ghost sm" disabled={buying !== null} onClick={() => void buy(r)} title={`Open checkout for ${r.qty} at the seller`}>
                      {buying === r.checkoutUrl ? <span className="spinner ink" /> : 'Buy'}
                    </button>
                  ) : r.listingUrl ? (
                    <a className="small" href={r.listingUrl} target="_blank" rel="noreferrer">
                      Listing
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              <div className="bill-row">
                <b>Total</b>
                <b>{money(bill.reduce((t, r) => t + r.qty * r.price, 0))}</b>
                <span />
              </div>
              <div className="row">
                <button className="ghost sm" onClick={onPlan}>
                  Change equipment
                </button>
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <>
              {versions.map((v) => (
                <button key={v.id} className={`version${v.id === current.id ? ' on' : ''}`} onClick={() => onChange({ currentId: v.id })} title={v.diff.join('\n')}>
                  <span className="version-id">{v.id}</span>
                  <span className="version-body">
                    <b>{v.label}</b>
                    <span>
                      {num(v.metrics.sim.unitsPerHour.median)} an hour · {num(v.metrics.sim.leadTimeSec.median / 60)} min · {money(v.metrics.cost.costPerUnit)} a unit
                    </span>
                  </span>
                </button>
              ))}
              <div className="section">
                <div className="row">
                  <button className="ghost sm" disabled={versions.length < 2} onClick={() => setCmp({ a: v1.id, b: current.id === v1.id ? versions[versions.length - 1].id : current.id })}>
                    Compare two versions
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {dirty && (
          <div className="panel-foot">
            <span>Unsaved changes</span>
            <button className="text sm" onClick={() => setDraft(current.spec)}>
              Discard
            </button>
            <button className="primary sm" onClick={save}>
              Save as v{nextN}
            </button>
          </div>
        )}
      </aside>

      <div className="dock" style={narrow ? undefined : { right: PANEL + 40 }}>
        {liveErrors.length > 0 && (
          <Notice tone="error" title={preview ? 'It cannot go here' : 'That change breaks a layout rule'} lines={liveErrors.slice(0, 3).map((e) => e.message)} onClose={preview ? undefined : () => setRejected([])} />
        )}
        {notice && !liveErrors.length && <Notice tone={notice.tone} title={notice.title} lines={notice.lines} onClose={() => setNotice(null)} />}
        <RunStatus state={run} />

        {/* Live Speaker Bar for walking & speaking 3D floor characters */}
        {speech && (
          <div className="speaker-bar" role="status" aria-live="polite">
            <div className="speaker-top">
              <div className="speaker-who">
                <span className="adv-dot" style={{ background: ADVOCATE_CHARACTERS[speech.role].accent }} />
                <b>{ADVOCATE_CHARACTERS[speech.role].name}</b>
                <span>
                  {ADVOCATE_CHARACTERS[speech.role].shortTitle} · {speech.targetLabel}
                  {speech.loading ? ' · synthesising voice…' : speech.playing ? ' · speaking' : ''}
                </span>
              </div>
              <div className="speaker-controls">
                {findings.length > 1 && (
                  <button
                    className="icon-btn"
                    title="Previous inspector"
                    aria-label="Previous inspector"
                    onClick={() => {
                      const curIdx = findings.findIndex((f) => f.id === speech.findingId);
                      const prevIdx = curIdx <= 0 ? findings.length - 1 : curIdx - 1;
                      if (walkthroughIdx !== null) startWalkthroughAt(prevIdx);
                      else hearFinding(findings[prevIdx]);
                    }}
                  >
                    <Icon name="prev" size={14} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  title={speech.playing ? 'Pause voice' : 'Replay voice'}
                  aria-label={speech.playing ? 'Pause voice' : 'Replay voice'}
                  onClick={() => {
                    if (speech.playing && audioRef.current) {
                      audioRef.current.pause();
                      setSpeech((s) => (s ? { ...s, playing: false } : null));
                    } else {
                      void speakAs(speech.role, speech.text, speech.targetLabel, speech.findingId);
                    }
                  }}
                >
                  <Icon name={speech.playing ? 'pause' : 'play'} size={14} />
                </button>
                {findings.length > 1 && (
                  <button
                    className="icon-btn"
                    title="Next inspector"
                    aria-label="Next inspector"
                    onClick={() => {
                      const curIdx = findings.findIndex((f) => f.id === speech.findingId);
                      const nextIdx = (curIdx + 1) % findings.length;
                      if (walkthroughIdx !== null) startWalkthroughAt(nextIdx);
                      else hearFinding(findings[nextIdx]);
                    }}
                  >
                    <Icon name="next" size={14} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  title={muted ? 'Unmute voice' : 'Mute voice'}
                  aria-label={muted ? 'Unmute voice' : 'Mute voice'}
                  onClick={() => {
                    const nextMuted = !muted;
                    setMuted(nextMuted);
                    if (nextMuted && audioRef.current) {
                      audioRef.current.pause();
                      setSpeech((s) => (s ? { ...s, playing: false } : null));
                    }
                  }}
                >
                  <Icon name={muted ? 'volumeOff' : 'volume'} size={14} />
                </button>
                <button className="icon-btn" title="Close speaker bar" aria-label="Close speaker bar" onClick={stopWalkthrough}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
            <p className="speaker-line">“{speech.text}”</p>
            {speech.error && <span className="speaker-err">{speech.error}</span>}
          </div>
        )}

        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) void sendEdit({ text: command.trim() });
          }}
        >
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Say what to change, like move shipping to the south wall" disabled={busy} aria-label="Change the layout in words" />
          <button type="button" className={recording ? 'ghost rec sm' : 'icon-btn'} disabled={busy && !recording} onClick={() => void toggleMic()} aria-label={recording ? 'Stop recording and apply' : 'Speak a change'} title={recording ? 'Stop and apply' : 'Speak a change'}>
            <Icon name={recording ? 'stop' : 'mic'} /> {recording ? 'Stop' : ''}
          </button>
          <button className="primary" disabled={busy || !command.trim()} aria-label="Apply the change">
            <Icon name="arrowUp" />
          </button>
        </form>
      </div>

      {cmp && cmpA && cmpB && <CompareModal versions={versions} a={cmpA} b={cmpB} models={project.models} onPick={(k, id) => setCmp({ ...cmp, [k]: id })} onClose={() => setCmp(null)} />}
    </div>
  );
}
