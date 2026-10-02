import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { MOVEMENT_PROFILES, PHYSICS_PROFILES, type HouseDNA, type Seed } from '../domain';
import { DoorSwing } from '../house/door';
import { INTERACTION_RANGE, rayBoxDistance, viewDirection } from '../house/interaction';
import { buildHouseLayout, roomAt, type HouseLayout, type HouseMaterial } from '../house/layout';
import type { Rapier } from '../platform/physics';
import { disposeObject3D } from '../runtime/dispose';
import { Player, type MoveIntent } from '../runtime/player';
import type { FrameInput, Stage } from '../runtime/stage';

export interface HouseStageEvents {
  /** The door is in reach and looked at (true) or no longer is (false). */
  onFocusChange?: (inReach: boolean) => void;
  /** The visitor opened a door. */
  onDoorOpened?: (doorId: string) => void;
  /** The visitor walked into another room. */
  onRoomChange?: (roomId: string) => void;
}

export interface HouseStageOptions {
  /** Light behind the door: a hint of the destination it currently leads to. */
  doorLight: string;
  /** Where the visitor appears: the start room, or the corridor when returning. */
  arrival: 'start' | 'corridor';
}

const DEFAULT_OPTIONS: HouseStageOptions = { doorLight: '#FFE6C4', arrival: 'start' };

/** The House: always EARTH gravity, walking only. */
export class HouseStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  readonly layout: HouseLayout;
  readonly player: Player;
  readonly door = new DoorSwing();
  inReach = false;
  /** Room the visitor is standing in. */
  room: string;

  private readonly world: RAPIER.World;
  private readonly doorPivot = new THREE.Group();
  private readonly floodLight: THREE.PointLight;
  private readonly doorLight: string;

  constructor(
    rapier: Rapier,
    dna: HouseDNA,
    seed: Seed,
    private readonly events: HouseStageEvents = {},
    options: Partial<HouseStageOptions> = {},
  ) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    this.doorLight = opts.doorLight;
    const physics = PHYSICS_PROFILES.EARTH;
    this.layout = buildHouseLayout(dna, seed);
    this.world = new rapier.World(physics.gravity);
    this.scene.background = new THREE.Color('#050506');

    const materials = createMaterials(dna);
    for (const s of this.layout.solids) {
      if (s.material !== 'none') {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z),
          materials[s.material],
        );
        mesh.position.set(s.centre.x, s.centre.y, s.centre.z);
        mesh.castShadow = s.material !== 'window';
        mesh.receiveShadow = s.material !== 'window';
        this.scene.add(mesh);
      }
      if (s.collide) {
        this.world.createCollider(
          rapier.ColliderDesc.cuboid(s.size.x / 2, s.size.y / 2, s.size.z / 2).setTranslation(
            s.centre.x,
            s.centre.y,
            s.centre.z,
          ),
        );
      }
    }

    this.buildDoor(dna);
    this.buildLamp(dna);
    this.floodLight = this.buildLights(dna);

    const spawn =
      opts.arrival === 'corridor' ? this.layout.corridorArrival : this.layout.house.spawn;
    this.room = spawn.roomId;
    this.player = new Player(rapier, this.world, {
      position: spawn.position,
      yaw: spawn.facing,
      movement: MOVEMENT_PROFILES.WALK,
      physics,
    });
    this.world.step();
    this.updateCamera();
  }

  get doorState() {
    return this.door.state;
  }

  look(deltaYaw: number, deltaPitch: number): void {
    this.player.look(deltaYaw, deltaPitch);
  }

  fixedUpdate(intent: MoveIntent, dt: number): void {
    this.player.fixedStep(intent, dt);
    this.world.timestep = dt;
    this.world.step();

    const feet = this.player.feet;
    const room = roomAt(this.layout.house, feet.x, feet.z);
    if (room && room !== this.room) {
      this.room = room;
      this.events.onRoomChange?.(room);
    }
  }

  frameUpdate(frameDt: number, input: FrameInput): void {
    this.updateCamera();

    const reach = this.door.state === 'CLOSED' && this.isLookingAtDoor();
    if (reach !== this.inReach) {
      this.inReach = reach;
      this.events.onFocusChange?.(reach);
    }
    if (reach && input.interact && this.door.open()) {
      this.events.onDoorOpened?.(this.layout.door.id);
    }

    this.door.update(frameDt);
    this.doorPivot.rotation.y = this.door.angle;
    // Light floods out as the door swings.
    this.floodLight.intensity = 8 * Math.min(1, this.door.progress * 1.6);
  }

  dispose(): void {
    this.player.dispose();
    this.world.free();
    disposeObject3D(this.scene);
  }

  private isLookingAtDoor(): boolean {
    const d = this.layout.door;
    const eye = this.player.eye;
    const dir = viewDirection(this.player.yaw, this.player.pitch);
    const min = { x: d.hinge.x, y: 0, z: d.faceZ - d.thickness };
    const max = { x: d.hinge.x + d.width, y: d.height, z: d.faceZ };
    return rayBoxDistance(eye, dir, min, max, INTERACTION_RANGE) !== null;
  }

  private updateCamera(): void {
    const eye = this.player.eye;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
  }

  private buildDoor(dna: HouseDNA): void {
    const d = this.layout.door;
    const gap = 0.015; // light leaks through here
    const timber = new THREE.MeshStandardMaterial({ color: dna.palette.door, roughness: 0.62 });
    const brass = new THREE.MeshStandardMaterial({
      color: dna.palette.brass,
      metalness: 0.8,
      roughness: 0.45,
    });

    this.doorPivot.position.set(d.hinge.x, 0, d.faceZ - d.thickness / 2);
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(d.width, d.height - gap, d.thickness),
      timber,
    );
    leaf.position.set(d.width / 2, gap + (d.height - gap) / 2, 0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    this.doorPivot.add(leaf);

    // Two recessed-looking panels: slightly proud boxes on the room face.
    for (const [y, h] of [
      [0.25, 0.95],
      [1.35, 0.85],
    ] as const) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(d.width - 0.3, h, 0.012), timber);
      panel.position.set(d.width / 2, y + h / 2, d.thickness / 2 + 0.006);
      panel.castShadow = true;
      this.doorPivot.add(panel);
    }

    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), brass);
    handle.position.set(d.width - 0.1, 1.05, d.thickness / 2 + 0.045);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), brass);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(d.width - 0.1, 1.05, d.thickness / 2 + 0.02);
    this.doorPivot.add(handle, rose);
    this.scene.add(this.doorPivot);

    // The lit space beyond the door, seen through the gap and when it opens.
    const glow = new THREE.MeshBasicMaterial({ color: this.doorLight, side: THREE.BackSide });
    const lb = d.lightBox;
    const box = new THREE.Mesh(new THREE.BoxGeometry(lb.size.x, lb.size.y, lb.size.z), glow);
    box.position.set(lb.centre.x, lb.centre.y, lb.centre.z);
    this.scene.add(box);

    // The thin line of light under the door: a bright sliver on the boards and a faint spill.
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(d.width * 0.96, 0.05),
      new THREE.MeshBasicMaterial({ color: this.doorLight, transparent: true, opacity: 0.55 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(d.hinge.x + d.width / 2, 0.002, d.faceZ + 0.02);
    this.scene.add(strip);
    const spill = new THREE.PointLight(this.doorLight, 0.35, 1.6, 2);
    spill.position.set(d.hinge.x + d.width / 2, 0.03, d.faceZ + 0.08);
    this.scene.add(spill);
  }

  private buildLamp(dna: HouseDNA): void {
    const { base, height } = this.layout.lamp;
    const brass = new THREE.MeshStandardMaterial({
      color: dna.palette.brass,
      metalness: 0.8,
      roughness: 0.5,
    });
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.03, 24), brass);
    foot.position.set(base.x, 0.015, base.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, height - 0.2, 12), brass);
    pole.position.set(base.x, (height - 0.2) / 2, base.z);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.24, 0.3, 32, 1, true),
      new THREE.MeshStandardMaterial({
        color: '#E6D2B0',
        emissive: dna.lighting.lampColour,
        emissiveIntensity: 0.9,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    shade.position.set(base.x, height - 0.1, base.z);
    for (const m of [foot, pole, shade]) m.castShadow = true;
    this.scene.add(foot, pole, shade);
  }

  /** Dusk: cold window light, one warm lamp, soft shadow elsewhere. Returns the door flood light. */
  private buildLights(dna: HouseDNA): THREE.PointLight {
    const { lamp, door, window: win, windowLightFrom } = this.layout;

    this.scene.add(new THREE.HemisphereLight(dna.lighting.windowColour, '#4A443C', 1.1));

    const windowLight = new THREE.SpotLight(dna.lighting.windowColour, 700, 0, 0.5, 0.7, 2);
    windowLight.position.set(windowLightFrom.x, windowLightFrom.y, windowLightFrom.z);
    windowLight.target.position.set(win.centre.x + 4, 0, win.centre.z - 0.5);
    windowLight.castShadow = true;
    windowLight.shadow.mapSize.set(2048, 2048);
    windowLight.shadow.bias = -0.0005;
    this.scene.add(windowLight, windowLight.target);

    const lampLight = new THREE.PointLight(dna.lighting.lampColour, 4.5, 0, 2);
    lampLight.position.set(lamp.base.x, lamp.height - 0.12, lamp.base.z);
    this.scene.add(lampLight);

    // The door is the best-lit object: a soft warm wash aimed at it from the lamp side.
    const doorWash = new THREE.SpotLight(dna.lighting.lampColour, 6, 0, 0.6, 0.9, 2);
    doorWash.position.set(lamp.base.x - 0.3, 2.6, door.faceZ + 2.2);
    doorWash.target.position.set(door.hinge.x + door.width / 2, 1.2, door.faceZ);
    this.scene.add(doorWash, doorWash.target);

    const flood = new THREE.PointLight(this.doorLight, 0, 0, 2);
    flood.position.set(door.hinge.x + door.width / 2, 1.3, door.faceZ - 0.4);
    this.scene.add(flood);
    return flood;
  }
}

function createMaterials(dna: HouseDNA): Record<Exclude<HouseMaterial, 'none'>, THREE.Material> {
  const p = dna.palette;
  return {
    plaster: new THREE.MeshStandardMaterial({ color: p.plaster, roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: p.plaster, roughness: 1 }),
    panelling: new THREE.MeshStandardMaterial({ color: p.panelling, roughness: 0.55 }),
    rail: new THREE.MeshStandardMaterial({ color: p.panelling, roughness: 0.5 }),
    floor: new THREE.MeshStandardMaterial({ color: p.floor, roughness: 0.72 }),
    trim: new THREE.MeshStandardMaterial({ color: p.panelling, roughness: 0.55 }),
    // The window shows only pale fog: nothing beyond it.
    window: new THREE.MeshBasicMaterial({ color: '#BCC6CC' }),
  };
}
