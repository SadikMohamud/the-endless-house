// Temporary Phase 3 stage: a plain room to prove rendering, movement and collision.
// Replaced by the House in Phase 4.
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { DEFAULT_HOUSE_DNA, MOVEMENT_PROFILES, PHYSICS_PROFILES } from '../domain';
import type { Rapier } from '../platform/physics';
import { disposeObject3D } from '../runtime/dispose';
import { Player, type MoveIntent } from '../runtime/player';
import type { Stage } from '../runtime/stage';

const SIZE = 12;

export class TestRoomStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
  readonly player: Player;
  private readonly world: RAPIER.World;

  constructor(private readonly rapier: Rapier) {
    const physics = PHYSICS_PROFILES.EARTH;
    this.world = new rapier.World(physics.gravity);
    const { palette, ceilingHeight: h, wallThickness: t } = DEFAULT_HOUSE_DNA;

    this.scene.background = new THREE.Color('#0b0c0d');

    const floor = new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.8 });
    const wall = new THREE.MeshStandardMaterial({ color: palette.plaster, roughness: 0.95 });
    const panel = new THREE.MeshStandardMaterial({ color: palette.panelling, roughness: 0.6 });

    this.box(floor, { x: 0, y: -0.1, z: 0 }, { x: SIZE, y: 0.2, z: SIZE });
    const half = SIZE / 2;
    for (const [x, z, w, d] of [
      [0, -half, SIZE, t],
      [0, half, SIZE, t],
      [-half, 0, t, SIZE],
      [half, 0, t, SIZE],
    ] as const) {
      this.box(wall, { x, y: h / 2, z }, { x: w, y: h, z: d });
    }
    // A pillar to walk into.
    this.box(panel, { x: 2, y: h / 2, z: -2 }, { x: 0.8, y: h, z: 0.8 });

    this.scene.add(new THREE.HemisphereLight('#8FA6C8', '#3B2A20', 0.6));
    const windowLight = new THREE.DirectionalLight('#8FA6C8', 1.2);
    windowLight.position.set(-4, 6, 3);
    windowLight.castShadow = true;
    this.scene.add(windowLight);
    const lamp = new THREE.PointLight('#FFB36B', 6, 10, 2);
    lamp.position.set(3, 2.2, -4);
    this.scene.add(lamp);

    this.player = new Player(rapier, this.world, {
      position: { x: 0, y: 0, z: 4 },
      yaw: 0,
      movement: MOVEMENT_PROFILES.WALK,
      physics,
    });
    // Build the query pipeline so the first movement sees the colliders.
    this.world.step();
    this.updateCamera();
  }

  look(deltaYaw: number, deltaPitch: number): void {
    this.player.look(deltaYaw, deltaPitch);
  }

  fixedUpdate(intent: MoveIntent, dt: number): void {
    this.player.fixedStep(intent, dt);
    this.world.timestep = dt;
    this.world.step();
  }

  frameUpdate(): void {
    this.updateCamera();
  }

  dispose(): void {
    this.player.dispose();
    this.world.free();
    disposeObject3D(this.scene);
  }

  private updateCamera(): void {
    const eye = this.player.eye;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
  }

  private box(
    material: THREE.Material,
    centre: { x: number; y: number; z: number },
    size: { x: number; y: number; z: number },
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set(centre.x, centre.y, centre.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(
        centre.x,
        centre.y,
        centre.z,
      ),
    );
  }
}
