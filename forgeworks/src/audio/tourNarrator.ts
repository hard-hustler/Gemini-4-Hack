import { soundEngine } from './soundEngine';

export interface TourSpeechCallbacks {
  onStart?: () => void;
  onEnd?: (completedNormally: boolean) => void;
}

/**
 * Shared mutable speaking state read at 60 FPS by the 3D animated Plant Engineer
 * (mouth/jaw animation & hand gesturing) without causing React re-renders.
 */
export const tourVoiceStateRef = {
  speaking: false,
  energy: 0,
  startedAt: 0,
  durationMs: 7000,
};

class TourNarrator {
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private fallbackTimer: number | null = null;
  private safetyTimer: number | null = null;
  private speechId = 0;

  private pickVoice(): SpeechSynthesisVoice | null {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      !window.speechSynthesis
    ) {
      return null;
    }
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const preferredPatterns = [
      /Google US English/i,
      /Google UK English Female/i,
      /Microsoft Aria/i,
      /Microsoft Jenny/i,
      /Samantha/i,
      /Karen/i,
      /Victoria/i,
      /Natural.*English/i,
    ];
    for (const pat of preferredPatterns) {
      const match = voices.find((v) => pat.test(v.name));
      if (match) {
        this.selectedVoice = match;
        return match;
      }
    }
    const en = voices.find((v) => /^en/i.test(v.lang)) ?? voices[0];
    this.selectedVoice = en ?? null;
    return this.selectedVoice;
  }

  public stop(): void {
    this.speechId++;
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.safetyTimer !== null) {
      window.clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis
    ) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser speechSynthesis cancel quirks
      }
    }
    tourVoiceStateRef.speaking = false;
    tourVoiceStateRef.energy = 0;
    soundEngine.setVoiceDucking(false);
  }

  public speak(
    text: string,
    estimatedDurationMs: number,
    voiceEnabled: boolean,
    callbacks: TourSpeechCallbacks = {}
  ): void {
    this.stop();
    const myId = this.speechId;

    tourVoiceStateRef.speaking = true;
    tourVoiceStateRef.startedAt = performance.now();
    tourVoiceStateRef.durationMs = estimatedDurationMs;

    const finish = (completedNormally: boolean) => {
      if (myId !== this.speechId) return;
      if (this.fallbackTimer !== null) {
        window.clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      if (this.safetyTimer !== null) {
        window.clearTimeout(this.safetyTimer);
        this.safetyTimer = null;
      }
      tourVoiceStateRef.speaking = false;
      tourVoiceStateRef.energy = 0;
      soundEngine.setVoiceDucking(false);
      callbacks.onEnd?.(completedNormally);
    };

    const canSpeak =
      voiceEnabled &&
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined';

    if (!canSpeak) {
      callbacks.onStart?.();
      this.fallbackTimer = window.setTimeout(
        () => finish(true),
        estimatedDurationMs
      );
      return;
    }

    try {
      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(text);
      const voice = this.selectedVoice ?? this.pickVoice();
      if (voice) utter.voice = voice;
      utter.lang = voice?.lang || 'en-US';
      utter.rate = 1.02;
      utter.pitch = 1.04;
      utter.volume = 0.96;

      let settled = false;
      utter.onstart = () => {
        if (myId !== this.speechId) return;
        soundEngine.setVoiceDucking(true);
        tourVoiceStateRef.speaking = true;
        callbacks.onStart?.();
      };
      utter.onboundary = () => {
        if (myId !== this.speechId) return;
        tourVoiceStateRef.energy = 1;
      };
      utter.onend = () => {
        if (settled) return;
        settled = true;
        finish(true);
      };
      utter.onerror = () => {
        if (settled) return;
        settled = true;
        // If browser blocked autoplay speech or lacks TTS voices (e.g. headless),
        // seamlessly keep visual engineer presentation running for estimatedDurationMs
        soundEngine.setVoiceDucking(false);
        const remaining = Math.max(
          2200,
          estimatedDurationMs - (performance.now() - tourVoiceStateRef.startedAt)
        );
        this.fallbackTimer = window.setTimeout(() => finish(true), remaining);
      };

      // Chrome sometimes needs voices loaded asynchronously
      if (synth.getVoices().length === 0) {
        synth.onvoiceschanged = () => {
          this.pickVoice();
        };
      }

      callbacks.onStart?.();
      soundEngine.setVoiceDucking(true);
      synth.speak(utter);

      // Safety fallback in case a browser speech engine stalls without firing onend
      this.safetyTimer = window.setTimeout(() => {
        if (!settled && myId === this.speechId) {
          settled = true;
          try {
            synth.cancel();
          } catch {
            // ignore
          }
          finish(true);
        }
      }, estimatedDurationMs + 5500);
    } catch {
      callbacks.onStart?.();
      this.fallbackTimer = window.setTimeout(
        () => finish(true),
        estimatedDurationMs
      );
    }
  }
}

export const tourNarrator = new TourNarrator();
