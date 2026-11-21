// Spatialized Web Audio API multi-layered industrial factory soundscape (100% procedural, zero external files)
export interface FactorySoundMetrics {
  activeMachines: number;
  workingSmelters: number;
  workingAssemblers: number;
  workingExtractors: number;
  workingGenerators: number;
  activeItems: number;
  speed: number;
  listenerX: number;
  listenerZ: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Continuous layered factory ambience nodes
  private turbineOsc1: OscillatorNode | null = null;
  private turbineOsc2: OscillatorNode | null = null;
  private turbineFilter: BiquadFilterNode | null = null;
  private turbineGain: GainNode | null = null;

  private furnaceFilter: BiquadFilterNode | null = null;
  private furnaceGain: GainNode | null = null;

  private rollerFilter: BiquadFilterNode | null = null;
  private rollerGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private voiceDucking = false;
  private lastRattle = 0;
  private lastHiss = 0;
  private lastStamp = 0;
  private lastServo = 0;
  private lastDrill = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private getPinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.153852;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
      b6 = white * 0.115926;
    }
    this.noiseBuffer = buf;
    return buf;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.masterGain) return;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.85;
    master.connect(ctx.destination);
    this.masterGain = master;

    const pinkBuf = this.getPinkNoiseBuffer(ctx);

    // Layer 1: Deep heavy turbine & power-plant rumble (48 Hz + 96.5 Hz + slow LFO throb)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 48;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 96.5;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.8;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 14;

    const turbFilter = ctx.createBiquadFilter();
    turbFilter.type = 'lowpass';
    turbFilter.frequency.value = 135;
    turbFilter.Q.value = 1.6;
    lfo.connect(lfoGain);
    lfoGain.connect(turbFilter.frequency);

    const turbGain = ctx.createGain();
    turbGain.gain.value = 0;

    osc1.connect(turbFilter);
    osc2.connect(turbFilter);
    turbFilter.connect(turbGain);
    turbGain.connect(master);

    osc1.start();
    osc2.start();
    lfo.start();

    this.turbineOsc1 = osc1;
    this.turbineOsc2 = osc2;
    this.turbineFilter = turbFilter;
    this.turbineGain = turbGain;

    // Layer 2: Blast furnace roar & factory ventilation hall air rush
    const furnaceNoise = ctx.createBufferSource();
    furnaceNoise.buffer = pinkBuf;
    furnaceNoise.loop = true;

    const furnFilter = ctx.createBiquadFilter();
    furnFilter.type = 'bandpass';
    furnFilter.frequency.value = 240;
    furnFilter.Q.value = 0.75;

    const furnGain = ctx.createGain();
    furnGain.gain.value = 0;

    furnaceNoise.connect(furnFilter);
    furnFilter.connect(furnGain);
    furnGain.connect(master);
    furnaceNoise.start();

    this.furnaceFilter = furnFilter;
    this.furnaceGain = furnGain;

    // Layer 3: Continuous galvanized conveyor roller bed mechanical whirr
    const rollerNoise = ctx.createBufferSource();
    rollerNoise.buffer = pinkBuf;
    rollerNoise.loop = true;

    const rollFilter = ctx.createBiquadFilter();
    rollFilter.type = 'bandpass';
    rollFilter.frequency.value = 920;
    rollFilter.Q.value = 2.4;

    const rollLfo = ctx.createOscillator();
    rollLfo.type = 'sine';
    rollLfo.frequency.value = 6.2;
    const rollLfoGain = ctx.createGain();
    rollLfoGain.gain.value = 0.008;

    const rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollLfo.connect(rollLfoGain);
    rollLfoGain.connect(rollGain.gain);

    rollerNoise.connect(rollFilter);
    rollFilter.connect(rollGain);
    rollGain.connect(master);
    rollerNoise.start();
    rollLfo.start();

    this.rollerFilter = rollFilter;
    this.rollerGain = rollGain;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      const target = muted ? 0 : this.voiceDucking ? 0.34 : 0.85;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
    }
  }

  public setVoiceDucking(active: boolean): void {
    this.voiceDucking = active;
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(
        active ? 0.34 : 0.85,
        this.ctx.currentTime,
        0.22
      );
    }
  }

  public updateAmbientHum(activeMachines: number, speed: number): void {
    this.updateFactorySoundscape({
      activeMachines,
      workingSmelters: Math.min(4, Math.ceil(activeMachines * 0.15)),
      workingAssemblers: Math.min(4, Math.ceil(activeMachines * 0.15)),
      workingExtractors: Math.min(6, Math.ceil(activeMachines * 0.2)),
      workingGenerators: 4,
      activeItems: activeMachines * 4,
      speed,
      listenerX: 30,
      listenerZ: 30,
    });
  }

  public updateFactorySoundscape(m: FactorySoundMetrics): void {
    if (!this.ctx || !this.turbineGain || !this.furnaceGain || !this.rollerGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const running = !this.muted && m.speed > 0;
    const speedFactor = Math.min(1.6, 0.75 + Math.sqrt(Math.max(0, m.speed)) * 0.25);

    // Distance weighting toward Power Plant (21,20) and Smelting Bay (24,29)
    const powerProx = Math.max(
      0.35,
      1 - Math.hypot(m.listenerX - 21, m.listenerZ - 20) / 36
    );
    const smelterProx = Math.max(
      0.3,
      1 - Math.hypot(m.listenerX - 24.5, m.listenerZ - 29) / 30
    );

    const turbineTarget = running
      ? Math.min(0.06, (0.014 + m.workingGenerators * 0.0055) * powerProx)
      : 0;
    this.turbineGain.gain.setTargetAtTime(turbineTarget, now, 0.25);
    if (this.turbineFilter) {
      this.turbineFilter.frequency.setTargetAtTime(
        105 + Math.min(140, m.activeMachines * 3.5) * speedFactor,
        now,
        0.25
      );
    }
    if (this.turbineOsc1 && this.turbineOsc2) {
      this.turbineOsc1.frequency.setTargetAtTime(46 + speedFactor * 4, now, 0.3);
      this.turbineOsc2.frequency.setTargetAtTime(92 + speedFactor * 8, now, 0.3);
    }

    const furnaceTarget = running
      ? Math.min(0.095, (0.02 + m.workingSmelters * 0.015) * smelterProx)
      : 0;
    this.furnaceGain.gain.setTargetAtTime(furnaceTarget, now, 0.25);
    if (this.furnaceFilter) {
      this.furnaceFilter.frequency.setTargetAtTime(
        210 + smelterProx * 120,
        now,
        0.25
      );
    }

    const rollerTarget =
      running && m.activeItems > 0
        ? Math.min(0.036, 0.009 + Math.min(1, m.activeItems / 120) * 0.024)
        : 0;
    this.rollerGain.gain.setTargetAtTime(rollerTarget, now, 0.25);
    if (this.rollerFilter) {
      this.rollerFilter.frequency.setTargetAtTime(
        780 + speedFactor * 260,
        now,
        0.25
      );
    }
  }

  private computeSpatial(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ) {
    const dx = worldX - listenerX;
    const dz = worldZ - listenerZ;
    const dist = Math.hypot(dx, dz);
    const pan = Math.max(-1, Math.min(1, dx / 20));
    const atten = Math.max(0.06, 1 - dist / 42);
    return { pan, atten };
  }

  /** Realistic pneumatic air-valve release burst ("Pssshh!") from CNC & robotic arms */
  public playPneumaticHiss(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    const nowMs = performance.now();
    if (this.muted || nowMs - this.lastHiss < 1650) return;
    this.lastHiss = nowMs;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const dur = 0.24;
    const buf = this.getPinkNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2400;

    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.055 * atten, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  /** Heavy hydraulic press / CNC chuck metallic stamp */
  public playMetalStamp(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    const nowMs = performance.now();
    if (this.muted || nowMs - this.lastStamp < 1250) return;
    this.lastStamp = nowMs;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const t = ctx.currentTime;
    // Low hydraulic impact thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(115, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.14);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.11 * atten, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    // Metallic ring transient
    const clang = ctx.createOscillator();
    clang.type = 'triangle';
    clang.frequency.setValueAtTime(520 + Math.random() * 140, t);
    clang.frequency.exponentialRampToValueAtTime(310, t + 0.12);

    const clangGain = ctx.createGain();
    clangGain.gain.setValueAtTime(0.026 * atten, t);
    clangGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    thump.connect(thumpGain);
    thumpGain.connect(panner);
    clang.connect(clangGain);
    clangGain.connect(panner);
    panner.connect(this.masterGain);

    thump.start(t);
    thump.stop(t + 0.17);
    clang.start(t);
    clang.stop(t + 0.14);
  }

  /** Subtle robotic arm stepper servo whir */
  public playServoWhir(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    const nowMs = performance.now();
    if (this.muted || nowMs - this.lastServo < 950) return;
    this.lastServo = nowMs;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(290, t);
    osc.frequency.linearRampToValueAtTime(420, t + 0.12);
    osc.frequency.linearRampToValueAtTime(270, t + 0.22);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 360;
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.022 * atten, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Rotary quarry drill mechanical chug */
  public playDrillRumble(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    const nowMs = performance.now();
    if (this.muted || nowMs - this.lastDrill < 1400) return;
    this.lastDrill = nowMs;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(64, t);
    osc.frequency.linearRampToValueAtTime(52, t + 0.28);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.055 * atten, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  public playPlace(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(72, ctx.currentTime + 0.09);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14 * atten, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain ?? ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
  }

  public playBeltRattle(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    const now = performance.now();
    if (this.muted || now - this.lastRattle < 480) return;
    this.lastRattle = now;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 720;

    const gain = ctx.createGain();
    gain.gain.value = 0.042 * atten;

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain ?? ctx.destination);
    noise.start();
  }

  public playBreakdownAlarm(
    worldX: number,
    worldZ: number,
    listenerX: number,
    listenerZ: number
  ): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const { pan, atten } = this.computeSpatial(
      worldX,
      worldZ,
      listenerX,
      listenerZ
    );

    [0, 0.14].forEach((delay, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = idx === 0 ? 740 : 560;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08 * atten, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + delay + 0.11
      );

      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.masterGain ?? ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  }

  public playChime(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.065, ctx.currentTime + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.07 + 0.28
      );
      osc.connect(gain);
      gain.connect(this.masterGain ?? ctx.destination);
      osc.start(ctx.currentTime + i * 0.07);
      osc.stop(ctx.currentTime + i * 0.07 + 0.3);
    });
  }
}

export const soundEngine = new SoundEngine();
