import type { Journey } from '../domain';

/** Everything the overlay shows (spec §52). Only the current visitor's own journey. */
export interface DiagnosticsSnapshot {
  renderer: string;
  journeyId: string | null;
  location: string;
  roomId: string | null;
  worldId: string | null;
  seed: string | null;
  generatorVersion: string | null;
  visualProfile: string | null;
  physicsProfile: string;
  movementProfile: string;
  gravity: number;
  loadedAssets: { geometries: number; textures: number; drawCalls: number; triangles: number };
  fps: number;
  frameMs: number;
  frameP95Ms: number;
  cpuMs: number;
  /** Chrome-only JS heap figure; null where the browser does not expose it. */
  jsHeapMb: number | null;
  online: boolean;
  transitionGraph: string;
}

/** The journey as a path of places: start-room → door-1 → w-… → return-frame → corridor. */
export function transitionGraph(journey: Journey | null, maxSteps = 9): string {
  if (!journey) return '(no journey)';
  const steps: string[] = [];
  for (const e of journey.history) {
    if (e.type === 'HOUSE_ENTERED') steps.push(e.roomId);
    else if (e.type === 'DOOR_OPENED') steps.push(e.doorId);
    else if (e.type === 'WORLD_ENTERED') steps.push(e.worldId);
  }
  const shown = steps.length > maxSteps ? ['…', ...steps.slice(-maxSteps)] : steps;
  return shown.join(' → ');
}

const pad = (label: string) => label.padEnd(11);
const fixed = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '-');

export function formatDiagnostics(s: DiagnosticsSnapshot): string {
  const a = s.loadedAssets;
  return [
    `${pad('renderer')}${s.renderer}`,
    `${pad('journey')}${s.journeyId ?? '-'}`,
    `${pad('location')}${s.location}${s.roomId ? ` / ${s.roomId}` : ''}`,
    `${pad('world')}${s.worldId ?? '-'}`,
    `${pad('seed')}${s.seed ?? '-'}`,
    `${pad('generator')}${s.generatorVersion ?? '-'}`,
    `${pad('visual')}${s.visualProfile ?? '-'}`,
    `${pad('physics')}${s.physicsProfile} (g ${fixed(s.gravity, 2)} m/s²)`,
    `${pad('movement')}${s.movementProfile}`,
    `${pad('fps')}${fixed(s.fps, 0)}  frame ${fixed(s.frameMs)} ms  p95 ${fixed(s.frameP95Ms)} ms  cpu ${fixed(s.cpuMs, 2)} ms`,
    `${pad('assets')}${a.geometries} geometries  ${a.textures} textures`,
    `${pad('draw')}${a.drawCalls} calls  ${a.triangles.toLocaleString('en-GB')} triangles`,
    `${pad('memory')}${s.jsHeapMb === null ? 'n/a' : `${fixed(s.jsHeapMb, 0)} MB JS heap`}`,
    `${pad('network')}${s.online ? 'online' : 'offline'} (not required)`,
    `${pad('path')}${s.transitionGraph}`,
  ].join('\n');
}

/**
 * The overlay itself: hidden until the backtick key is pressed. Refreshes at 4 Hz while visible.
 */
export class DiagnosticsOverlay {
  private visible = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly collect: () => DiagnosticsSnapshot,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    if (this.visible) {
      this.render();
      this.timer = setInterval(() => this.render(), 250);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  render(): void {
    this.element.textContent = formatDiagnostics(this.collect());
  }
}
