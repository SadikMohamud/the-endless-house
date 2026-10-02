import type * as THREE from 'three/webgpu';
import type { MoveIntent } from './player';

/** One-shot actions gathered once per rendered frame. */
export interface FrameInput {
  interact: boolean;
}

/** One place the visitor can be: the House or a world. The engine runs exactly one at a time. */
export interface Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Mouse look, applied every rendered frame for responsiveness. */
  look(deltaYaw: number, deltaPitch: number): void;
  /** Simulation at a fixed timestep. */
  fixedUpdate(intent: MoveIntent, dt: number): void;
  /** Per rendered frame, after simulation: interaction, camera and visuals. */
  frameUpdate(frameDt: number, input: FrameInput): void;
  /** Releases every GPU and physics resource the stage created. */
  dispose(): void;
}
