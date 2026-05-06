export interface LoopSignal {
  loopCount: number;
  isLooping: boolean;
}

type SeenItem = { hash: string; at: number };

export class LoopDetector {
  private readonly seen = new Map<string, SeenItem[]>();

  constructor(
    private readonly windowMs: number,
    private readonly loopThreshold: number
  ) {}

  inspect(key: string, prompt: string, now = Date.now()): LoopSignal {
    const hash = `${key}:${prompt.trim().toLowerCase()}`;
    const events = this.seen.get(key) ?? [];
    const filtered = events.filter(e => now - e.at <= this.windowMs);
    filtered.push({ hash, at: now });
    this.seen.set(key, filtered);

    const loopCount = filtered.filter(e => e.hash === hash).length;
    return { loopCount, isLooping: loopCount >= this.loopThreshold };
  }

  reset(): void {
    this.seen.clear();
  }
}
