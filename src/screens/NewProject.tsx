import { useRef, useState } from 'react';
import type { PlanResult } from '../contracts';
import { apiStream, ApiError, type Project } from '../store';
import { fileToBase64, startRecording, type Recorder } from '../ui/audio';
import { Notice, RunStatus, TopBar, useRun } from '../ui/common';
import { Icon } from '../ui/icons';

interface Attachment {
  name: string;
  mimeType: string;
  data: string;
}

const EXAMPLES: { label: string; text: string; sketch?: string }[] = [
  {
    label: 'CNC machine shop',
    text: 'A machine shop with one production line of 27 machines that makes 60 machined aluminium bike-light housings an hour, laid out as in the attached sketch on a 36 by 24 metre floor. Aluminium bar stock arrives at the west dock, is checked in at a receiving desk and stored on pallet racks, cut to length on a metal-cutting bandsaw, turned on CNC lathes (about 4 minutes a part), milled on CNC milling machines (about 9 minutes a part), tumbled in vibratory deburring machines, cleaned in a parts washer, measured on coordinate measuring machines, serial-numbered on a fibre laser marking machine, then packed and palletised for shipping at the east dock. Parts move between steps on conveyors.',
    // the brief is two things: this text and a paper sketch of where each machine stands
    sketch: '/img/machine-shop-sketch.jpg?v=2',
  },
  {
    label: 'Espresso grinder line',
    text: 'We assemble small espresso grinders. Parts arrive on pallets, get kitted, then burr sub-assembly, final assembly, a run-in test, then pack and ship. About 40 units an hour. The unit is 16 by 12 metres, roller door on the west side, shipping out the east. Water is on the south wall.',
  },
  {
    label: 'Bike wheel workshop',
    text: 'A bike wheel workshop in a 14 by 10 m unit: rim and spoke storage, lacing, truing, inspection, then boxing. 25 wheels an hour. One roller door on the south wall for both receiving and shipping.',
  },
];

export function NewProject({ onHome, onCreated, initialText = '' }: { onHome: () => void; onCreated: (p: Project) => void; /** a brief typed on the landing page */ initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useRun();
  const busy = run.busy;

  const addFiles = async (list: FileList | File[]) => {
    const added: Attachment[] = [];
    for (const f of Array.from(list)) added.push({ name: f.name, mimeType: f.type || 'application/octet-stream', data: await fileToBase64(f) });
    setFiles((cur) => [...cur, ...added]);
  };
  const addSketch = async (url: string) => {
    const blob = await (await fetch(url)).blob();
    const data = await fileToBase64(blob);
    // one sketch at a time: a second drawing of a different floor would only confuse the planner
    setFiles((cur) => [...cur.filter((f) => !f.name.startsWith('floor-sketch.')), { name: `floor-sketch.${url.split('?')[0].split('.').pop()}`, mimeType: blob.type || 'image/png', data }]);
  };
  const addSampleSketch = () => addSketch('/sample-sketch.png');
  const toggleMic = async () => {
    setError(null);
    if (recording && recorder.current) {
      setRecording(false);
      const rec = recorder.current;
      recorder.current = null;
      try {
        const audio = await rec.stop();
        setFiles((cur) => [...cur, { name: `Voice note ${cur.filter((f) => f.mimeType.startsWith('audio/')).length + 1}`, ...audio }]);
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

  const ready = (text.trim().length > 0 || files.length > 0) && !busy && !recording;
  const submit = async () => {
    if (!ready) return;
    setError(null);
    try {
      const { value: plan } = await run.run('Reading the brief', (onEvent) => apiStream<PlanResult>('/api/project/plan', { text, files }, onEvent));
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
    }
  };

  return (
    <div className="page">
      <TopBar onHome={onHome} crumbs={[{ label: 'Brief', active: true }, { label: 'Equipment' }, { label: 'Simulation' }]} />
      <main className="brief">
        <h1>What are you building, and where?</h1>
        <p className="lede">Say what the line makes, the steps it goes through, how many an hour, and the space you have. Anything you leave out gets assumed, and you can correct it on the next screen.</p>

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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
            }}
            placeholder="We assemble small espresso grinders. Parts arrive on pallets, get kitted, then…"
            rows={6}
            disabled={busy}
            aria-label="Project brief"
          />
          {files.length > 0 && (
            <div className="attachments">
              {files.map((f, i) => (
                <span key={i} className="attachment">
                  {f.mimeType.startsWith('image/') ? <img src={`data:${f.mimeType};base64,${f.data}`} alt="" /> : <Icon name={f.mimeType.startsWith('audio/') ? 'mic' : 'clip'} />}
                  {f.name}
                  <button className="icon-btn" onClick={() => setFiles(files.filter((_, k) => k !== i))} disabled={busy} aria-label={`Remove ${f.name}`}>
                    <Icon name="x" size={14} />
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
            <button className="text" onClick={() => input.current?.click()} disabled={busy}>
              <Icon name="clip" /> Sketch or PDF
            </button>
            <button className={recording ? 'ghost rec' : 'text'} onClick={() => void toggleMic()} disabled={busy}>
              <Icon name={recording ? 'stop' : 'mic'} /> {recording ? 'Stop recording' : 'Voice note'}
            </button>
            <span className="spacer" />
            <button className="primary" onClick={() => void submit()} disabled={!ready}>
              Create plan <Icon name="arrowRight" />
            </button>
          </div>
        </div>

        <div className="examples">
          Try
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              className="ghost sm"
              disabled={busy}
              onClick={() => {
                setText(ex.text);
                if (ex.sketch) void addSketch(ex.sketch);
                else setFiles((cur) => cur.filter((f) => !f.name.startsWith('floor-sketch.')));
              }}
            >
              {ex.label}
            </button>
          ))}
          <button className="ghost sm" disabled={busy} onClick={() => void addSampleSketch()}>
            A hand-drawn floor sketch
          </button>
        </div>

        {error && <Notice tone="error" title={error.message} lines={error.lines} onClose={() => setError(null)} />}
      </main>
      <div className="bottom-status">
        <RunStatus state={run} />
      </div>
    </div>
  );
}
