import type { MoveIntent } from './player';

const MOUSE_SENSITIVITY = 0.0022; // radians per pixel

/** Keyboard and pointer-lock mouse input. Only active while the pointer is locked. */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  private locked = false;
  private readonly listeners: Array<(locked: boolean) => void> = [];

  constructor(private readonly target: HTMLElement) {
    target.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  onLockChanged(listener: (locked: boolean) => void): void {
    this.listeners.push(listener);
  }

  /** Movement for this simulation step. Consumes one-shot presses. */
  intent(): MoveIntent {
    if (!this.locked) return { forward: 0, right: 0, sprint: false, jump: false };
    const axis = (pos: string, neg: string) =>
      (this.held.has(pos) ? 1 : 0) - (this.held.has(neg) ? 1 : 0);
    const intent: MoveIntent = {
      forward: axis('KeyW', 'KeyS'),
      right: axis('KeyD', 'KeyA'),
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      jump: this.pressed.has('Space'),
    };
    this.pressed.delete('Space');
    return intent;
  }

  /** True once per press of `code`. */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /**
   * Drops presses nobody consumed this frame, so a stale press cannot fire later.
   * Space survives until the next simulation step reads it via intent().
   */
  endFrame(): void {
    for (const code of this.pressed) if (code !== 'Space') this.pressed.delete(code);
  }

  /** Mouse movement since the last call, in radians. */
  takeLook(): { yaw: number; pitch: number } {
    const look = { yaw: this.dx * MOUSE_SENSITIVITY, pitch: this.dy * MOUSE_SENSITIVITY };
    this.dx = 0;
    this.dy = 0;
    return look;
  }

  dispose(): void {
    this.target.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
  }

  private onClick = () => {
    if (!this.locked) void this.target.requestPointerLock();
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.target;
    if (!this.locked) this.onBlur();
    for (const l of this.listeners) l(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.locked) return;
    if (!e.repeat) this.pressed.add(e.code);
    this.held.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private onBlur = () => {
    this.held.clear();
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
  };
}
