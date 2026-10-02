import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { HouseDNA, RealityConfiguration } from '../domain';
import type { GeneratedForest } from '../gen/forest';
import type { Rapier } from '../platform/physics';
import { disposeObject3D } from '../runtime/dispose';
import { Player, type MoveIntent } from '../runtime/player';
import type { Stage } from '../runtime/stage';
import { buildForestColliders, FRAME_POST, yawFacing } from '../world/forest-physics';
import { crossedFrame } from '../world/frame-crossing';

const SHADOW_EXTENT = 45;

/** A generated forest: terrain, instanced trees, fog, sun, and the lone door frame. */
export class ForestStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  readonly player: Player;
  private readonly world: RAPIER.World;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunDir: THREE.Vector3;
  private lastFeet: { x: number; y: number; z: number };
  private returned = false;

  constructor(
    rapier: Rapier,
    readonly reality: RealityConfiguration,
    readonly forest: GeneratedForest,
    dna: HouseDNA,
    private readonly events: { onReturn?: () => void } = {},
  ) {
    const { physicsProfile, environmentProfile: env, lightingProfile: light } = reality;
    const palette = reality.materialProfile.palette;
    this.world = new rapier.World(physicsProfile.gravity);
    buildForestColliders(rapier, this.world, forest);

    this.scene.background = new THREE.Color(env.fogColour);
    this.scene.fog = new THREE.Fog(env.fogColour, env.fogNear, env.fogFar);

    this.scene.add(this.buildTerrain(palette.ground ?? '#4B4A3A'));
    this.buildTrees(palette.trunk ?? '#3A332C', palette.foliage ?? '#2F4A36');
    this.buildFrame(dna);

    this.scene.add(
      new THREE.HemisphereLight(env.fogColour, palette.ground ?? '#4B4A3A', light.ambientIntensity),
    );
    const el = THREE.MathUtils.degToRad(light.sunElevation);
    const az = THREE.MathUtils.degToRad(light.sunAzimuth);
    this.sunDir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    this.sun = new THREE.DirectionalLight(light.sunColour, light.sunIntensity * 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 300;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    const s = forest.spawn;
    this.player = new Player(rapier, this.world, {
      position: { x: s.x, y: s.y + 0.1, z: s.z },
      // Forward is -Z at yaw 0, so face `facing` by turning from -Z.
      yaw: Math.atan2(-s.facing.x, -s.facing.z),
      movement: reality.movementProfile,
      physics: physicsProfile,
    });
    this.world.step();
    this.lastFeet = this.player.feet;
    this.frameUpdate();
  }

  /** Re-arms the frame after a return attempt that could not be completed. */
  allowReturn(): void {
    this.returned = false;
  }

  look(deltaYaw: number, deltaPitch: number): void {
    this.player.look(deltaYaw, deltaPitch);
  }

  fixedUpdate(intent: MoveIntent, dt: number): void {
    this.player.fixedStep(intent, dt);
    this.world.timestep = dt;
    this.world.step();

    // Walking through the lone frame is the way back.
    const feet = this.player.feet;
    if (!this.returned && crossedFrame(this.lastFeet, feet, this.forest.returnFrame)) {
      this.returned = true;
      this.events.onReturn?.();
    }
    this.lastFeet = feet;
  }

  frameUpdate(): void {
    const eye = this.player.eye;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
    // The shadow camera follows the visitor so nearby trees always cast shadows.
    const feet = this.player.feet;
    this.sun.target.position.set(feet.x, feet.y, feet.z);
    this.sun.position.set(feet.x, feet.y, feet.z).addScaledVector(this.sunDir, 120);
  }

  dispose(): void {
    this.player.dispose();
    this.world.free();
    disposeObject3D(this.scene);
  }

  private buildTerrain(colour: string): THREE.Mesh {
    const { size, segments: n, heights } = this.forest.terrain;
    const geometry = new THREE.PlaneGeometry(size, size, n, n);
    geometry.rotateX(-Math.PI / 2); // row 0 now lies at z = -size/2, matching the height grid
    const pos = geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i]!);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: colour, roughness: 1 }),
    );
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildTrees(trunkColour: string, foliageColour: string): void {
    const trees = this.forest.trees;
    const trunkGeometry = new THREE.CylinderGeometry(0.7, 1, 1, 7, 1);
    trunkGeometry.translate(0, 0.5, 0);
    const crownGeometry = new THREE.ConeGeometry(1, 1, 7, 1);
    crownGeometry.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeometry,
      new THREE.MeshStandardMaterial({ color: trunkColour, roughness: 0.92 }),
      trees.length,
    );
    const crowns = new THREE.InstancedMesh(
      crownGeometry,
      new THREE.MeshStandardMaterial({ color: foliageColour, roughness: 0.9 }),
      trees.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    trees.forEach((t, i) => {
      const sink = 0.3;
      trunks.setMatrixAt(
        i,
        m.compose(p.set(t.x, t.y - sink, t.z), q, s.set(t.radius, t.height + sink, t.radius)),
      );
      const crownHeight = t.height - t.crownBase + 2;
      crowns.setMatrixAt(
        i,
        m.compose(
          p.set(t.x, t.y + t.crownBase, t.z),
          q,
          s.set(t.crownRadius, crownHeight, t.crownRadius),
        ),
      );
    });
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }

  /** The way back: a lone door frame in the House's proportions, attached to nothing. */
  private buildFrame(dna: HouseDNA): void {
    const fr = this.forest.returnFrame;
    const timber = new THREE.MeshStandardMaterial({ color: dna.palette.door, roughness: 0.6 });
    const group = new THREE.Group();
    group.position.set(fr.x, fr.y, fr.z);
    group.rotation.y = yawFacing(fr.facing);
    const offset = fr.width / 2 + FRAME_POST / 2;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(FRAME_POST, fr.height + 0.2, FRAME_POST),
        timber,
      );
      post.position.set(offset * side, fr.height / 2 - 0.1, 0);
      group.add(post);
    }
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(fr.width + 2 * FRAME_POST, FRAME_POST, FRAME_POST),
      timber,
    );
    lintel.position.set(0, fr.height + FRAME_POST / 2, 0);
    group.add(lintel);
    group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.scene.add(group);
  }
}
