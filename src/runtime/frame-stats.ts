/** Rolling frame timing over the last `size` frames. */
export class FrameStats {
  private readonly intervals: number[] = [];
  private readonly work: number[] = [];

  constructor(private readonly size = 120) {}

  /** `intervalMs`: time since the previous frame. `workMs`: CPU time spent producing this one. */
  record(intervalMs: number, workMs: number): void {
    this.intervals.push(intervalMs);
    this.work.push(workMs);
    if (this.intervals.length > this.size) {
      this.intervals.shift();
      this.work.shift();
    }
  }

  get samples(): number {
    return this.intervals.length;
  }

  /** Frames per second over the window. */
  get fps(): number {
    const avg = mean(this.intervals);
    return avg > 0 ? 1000 / avg : 0;
  }

  /** Mean time between frames, ms. */
  get frameMs(): number {
    return mean(this.intervals);
  }

  /** 95th-percentile time between frames, ms: catches hitches the mean hides. */
  get frameP95Ms(): number {
    if (this.intervals.length === 0) return 0;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  }

  /** Mean CPU time per frame (simulation, update and render submission), ms. */
  get cpuMs(): number {
    return mean(this.work);
  }

  reset(): void {
    this.intervals.length = 0;
    this.work.length = 0;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
