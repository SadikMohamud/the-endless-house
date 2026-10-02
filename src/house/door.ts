import type { DoorState } from '../domain';

export const DOOR_SWING_SECONDS = 1.2;
/** Opens away from the visitor, just past square. */
export const DOOR_OPEN_ANGLE = (100 * Math.PI) / 180;

/** The door's swing over time. Pure: the stage maps `angle` onto the leaf. */
export class DoorSwing {
  state: DoorState = 'CLOSED';
  private elapsed = 0;

  /** Starts opening. Returns true only when this call began the swing. */
  open(): boolean {
    if (this.state !== 'CLOSED') return false;
    this.state = 'OPENING';
    this.elapsed = 0;
    return true;
  }

  update(dt: number): void {
    if (this.state !== 'OPENING') return;
    this.elapsed = Math.min(this.elapsed + dt, DOOR_SWING_SECONDS);
    if (this.elapsed >= DOOR_SWING_SECONDS) this.state = 'OPEN';
  }

  /** 0 closed → 1 fully open, eased so the heavy door starts and settles slowly. */
  get progress(): number {
    if (this.state === 'CLOSED') return 0;
    if (this.state === 'OPEN') return 1;
    const x = this.elapsed / DOOR_SWING_SECONDS;
    return 0.5 - Math.cos(Math.PI * x) / 2;
  }

  get angle(): number {
    return this.progress * DOOR_OPEN_ANGLE;
  }
}
