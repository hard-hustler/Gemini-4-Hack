import { useRef, useState } from 'react';
import type { PlanResult } from '../contracts';
import { api, ApiError, type Project } from '../store';
import { fileToBase64, startRecording, type Recorder } from '../ui/audio';
import { Notice, TopBar, Tracker } from '../ui/common';

interface Attachment {
  name: string;
  mimeType: string;
  data: string;
}

const SAMPLES = [
  'We assemble small espresso grinders. Parts arrive on pallets, get kitted, then burr sub-assembly, final assembly, a run-in test, then pack and ship. About 40 units an hour. The unit is 16 by 12 metres, roller door on the west side, shipping out the east. Water is on the south wall.',
  'A bike wheel workshop in a 14 by 10 m unit: rim and spoke storage, lacing, truing, inspection, then boxing. 25 wheels an hour. One roller door on the south wall for both receiving and shipping.',
];

export function NewProject({ onHome, onCreated }: { onHome: () => void; onCreated: (p: Project) => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[]) => {
    const added: Attachment[] = [];
    for (const f of Array.from(list)) added.push({ name: f.name, mimeType: f.type || 'application/octet-stream', data: await fileToBase64(f) });
    setFiles((cur) => [...cur, ...added]);
  };
  const addSampleSketch = async () => {
    const data = await fileToBase64(await (await fetch('/sample-sketch.png')).blob());
    setFiles((cur) => [...cur.filter((f) => f.name !== 'floor-sketch.png'), { name: 'floor-sketch.png', mimeType: 'image/png', data }]);
  };
  const toggleMic = async () => {
    setError(null);
    if (recording && recorder.current) {
      setRecording(false);
      const rec = recorder.current;
      recorder.current = null;
      try {
        const audio = await rec.stop();
        setFiles((cur) => [...cur, { name: `voice-note-${cur.filter((f) => f.mimeType.startsWith('audio/')).length + 1}.wav`, ...audio }]);
      } catch (e) {
        setError(new ApiError('Could not process the recording', [(e as Error).message]));
      }
      return;
    }
    try {
      recorder.current = await startRecording();
      setRecording(true);
    } catch (e) {
      setError(new ApiError('Microphone unavailable', [(e as Error).message]));
    }
  };

  const ready = (text.trim().length > 0 || files.length > 0) && files.every((f) => f.data) && !busy && !recording;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await api<PlanResult>('/api/project/plan', { text, files });
      onCreated({
        id: `p-${Date.now()}`,
        name: plan.requirements.name,
        createdAt: Date.now(),
        brief: { text, files: files.map(({ name, mimeType }) => ({ name, mimeType })) },
        requirements: plan.requirements,
        equipment: plan.equipment,
        coverage: plan.coverage,
        trace: plan.trace,
        versions: [],
        currentId: null,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar onHome={onHome} crumbs={[{ label: 'Brief', active: true }, { label: 'Equipment' }, { label: 'Simulation' }]} />
      <main className="brief">
        <span className="eyebrow">New project</span>
        <h1>What are you building, and where?</h1>
        <p className="lede">Say what the line makes, the steps it goes through, roughly how many an hour, and the space you have. A floor sketch or a spec sheet helps; anything you leave out is assumed and listed for you to correct.</p>

        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="We assemble small espresso grinders. Parts arrive on pallets, get kitted, then…"
            rows={6}
            disabled={busy}
            aria-label="Project brief"
          />
          {files.length > 0 && (
            <div className="attachments">
              {files.map((f, i) => (
                <span key={i} className="attachment">
                  {f.mimeType.startsWith('image/') && f.data ? <img src={`data:${f.mimeType};base64,${f.data}`} alt="" /> : <i>{f.mimeType.startsWith('audio/') ? 'voice' : f.mimeType.includes('pdf') ? 'pdf' : 'file'}</i>}
                  {f.name}
                  <button onClick={() => setFiles(files.filter((_, k) => k !== i))} disabled={busy} aria-label={`Remove ${f.name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-bar">
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button className="ghost" onClick={() => input.current?.click()} disabled={busy}>
              Add sketch or PDF
            </button>
            <button className={`ghost${recording ? ' rec' : ''}`} onClick={() => void toggleMic()} disabled={busy}>
              {recording ? 'Stop recording' : 'Record a voice note'}
            </button>
            <span className="spacer" />
            <button className="primary" onClick={() => void submit()} disabled={!ready}>
              {busy ? 'Planning…' : 'Create plan'}
            </button>
          </div>
        </div>

        <div className="samples">
          <span className="eyebrow">Or start from an example</span>
          <div className="sample-row">
            {SAMPLES.map((s, i) => (
              <button key={i} className="sample" disabled={busy} onClick={() => setText(s)}>
                {s.slice(0, 96)}…
              </button>
            ))}
            <button className="sample" disabled={busy} onClick={() => void addSampleSketch()}>
              <img src="/sample-sketch.png" alt="" />
              Attach a hand-drawn floor sketch
            </button>
          </div>
        </div>

        {error && <Notice tone="error" title={error.message} lines={error.lines} onClose={() => setError(null)} />}
      </main>
      <Tracker events={error?.trace ?? []} running={busy ? 'Hydrogen is reading the brief' : null} stages={['Plan', 'Equip', 'Check']} />
    </div>
  );
}
