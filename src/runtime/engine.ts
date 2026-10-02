import * as THREE from 'three/webgpu';
import type { Input } from './input';
import type { Stage } from './stage';

export const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.25;

export type RendererBackend = 'webgpu' | 'webgl2';

/** Owns the renderer and the frame loop, and runs the current stage. */
export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  backend: RendererBackend = 'webgl2';
  frames = 0;
  private stage: Stage | null = null;
  private accumulator = 0;
  private last = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly input: Input,
  ) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get currentStage(): Stage | null {
    return this.stage;
  }

  /** Replaces the running stage, disposing the previous one. */
  setStage(stage: Stage): void {
    this.stage?.dispose();
    this.stage = stage;
    this.accumulator = 0;
    this.resize();
  }

  start(): void {
    this.last = performance.now();
    void this.renderer.setAnimationLoop(this.frame);
  }

  private frame = (now: number) => {
    const frameDt = Math.min((now - this.last) / 1000, MAX_FRAME_DT);
    this.last = now;
    const stage = this.stage;
    if (!stage) return;

    const look = this.input.takeLook();
    stage.look(look.yaw, look.pitch);

    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_DT) {
      stage.fixedUpdate(this.input.intent(), FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    stage.frameUpdate(frameDt, { interact: this.input.consumePress('KeyE') });
    this.input.endFrame();
    this.renderer.render(stage.scene, stage.camera);
    this.frames++;
  };

  private resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.stage) {
      this.stage.camera.aspect = w / h;
      this.stage.camera.updateProjectionMatrix();
    }
  };
}
