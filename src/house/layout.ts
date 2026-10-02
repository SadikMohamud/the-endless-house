import { House, type HouseDNA, type Seed, type Vec3 } from '../domain';

export type HouseMaterial =
  'plaster' | 'ceiling' | 'panelling' | 'rail' | 'floor' | 'trim' | 'window' | 'none';

/** An axis-aligned box. `collide` boxes become static physics colliders. */
export interface Solid {
  centre: Vec3;
  size: Vec3;
  material: HouseMaterial;
  collide: boolean;
}

export interface DoorLayout {
  id: string;
  /** Hinge line, at floor level. The leaf extends +X from here when closed. */
  hinge: Vec3;
  width: number;
  height: number;
  thickness: number;
  /** Plane of the room-side face of the closed leaf. */
  faceZ: number;
  /** Interior of the lit space behind the door. */
  lightBox: { centre: Vec3; size: Vec3 };
}

export interface HouseLayout {
  house: House;
  solids: Solid[];
  door: DoorLayout;
  window: { centre: Vec3; width: number; height: number };
  lamp: { base: Vec3; height: number };
  /** Point inside the window opening, outside the House, that window light comes from. */
  windowLightFrom: Vec3;
}

const LINTEL = 0.6;
const PANEL_DEPTH = 0.025;
const RAIL_DEPTH = 0.04;
const RAIL_HEIGHT = 0.05;
const WINDOW = { width: 1.4, sill: 0.9, top: 3.6 };
const LIGHT_BOX_DEPTH = 1.6;

interface Opening {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/**
 * Builds the Milestone 1 House from its DNA. Layout runs along -Z:
 * start room (spawn) → corridor → door room, with the door on the far wall, on axis.
 * Pure and deterministic: no randomness, no rendering.
 */
export function buildHouseLayout(dna: HouseDNA, seed: Seed, houseId = 'house-1'): HouseLayout {
  const H = dna.ceilingHeight;
  const t = dna.wallThickness;
  const W = dna.firstRoom.width;
  const D = dna.firstRoom.depth;
  const cw = dna.corridorWidth;
  const L = dna.corridorLength;
  const openingTop = H - LINTEL;

  // Interior volumes.
  const start = { x0: -W / 2, x1: W / 2, z0: 0, z1: D };
  const corridor = { x0: -cw / 2, x1: cw / 2, z0: -L, z1: 0 };
  const doorRoom = { x0: -W / 2, x1: W / 2, z0: -L - D, z1: -L };
  const doorWallZ = doorRoom.z0;

  const solids: Solid[] = [];
  const corridorGap: Opening = { from: -cw / 2, to: cw / 2, bottom: 0, top: openingTop };
  const doorGap: Opening = {
    from: -dna.doorWidth / 2,
    to: dna.doorWidth / 2,
    bottom: 0,
    top: dna.doorHeight,
  };
  const windowCentreZ = D / 2;
  const windowGap: Opening = {
    from: windowCentreZ - WINDOW.width / 2,
    to: windowCentreZ + WINDOW.width / 2,
    bottom: WINDOW.sill,
    top: WINDOW.top,
  };

  /**
   * A wall whose interior face lies on `axis = at`, running from `a0` to `a1` along the other
   * horizontal axis, thickened away from the room by `outward` (+1 or -1).
   */
  const wall = (
    axis: 'x' | 'z',
    at: number,
    a0: number,
    a1: number,
    outward: 1 | -1,
    openings: Opening[] = [],
  ) => {
    const cuts = [...openings].sort((p, q) => p.from - q.from);
    const pieces: Array<{ from: number; to: number; bottom: number; top: number }> = [];
    let cursor = a0 - t;
    for (const o of cuts) {
      pieces.push({ from: cursor, to: o.from, bottom: 0, top: H });
      if (o.bottom > 0) pieces.push({ from: o.from, to: o.to, bottom: 0, top: o.bottom });
      if (o.top < H) pieces.push({ from: o.from, to: o.to, bottom: o.top, top: H });
      cursor = o.to;
    }
    pieces.push({ from: cursor, to: a1 + t, bottom: 0, top: H });

    const place = (
      from: number,
      to: number,
      bottom: number,
      top: number,
      depth: number,
      offset: number,
    ) => {
      const along = (from + to) / 2;
      const across = at + outward * offset;
      const len = to - from;
      return axis === 'z'
        ? {
            centre: { x: along, y: (bottom + top) / 2, z: across },
            size: { x: len, y: top - bottom, z: depth },
          }
        : {
            centre: { x: across, y: (bottom + top) / 2, z: along },
            size: { x: depth, y: top - bottom, z: len },
          };
    };

    for (const p of pieces) {
      if (p.to - p.from <= 1e-6 || p.top - p.bottom <= 1e-6) continue;
      solids.push({
        ...place(p.from, p.to, p.bottom, p.top, t, t / 2),
        material: 'plaster',
        collide: true,
      });
      // Panelling and dado rail on the room side, only where the piece reaches the floor.
      if (p.bottom === 0) {
        const from = Math.max(p.from, a0);
        const to = Math.min(p.to, a1);
        if (to - from <= 1e-6) continue;
        const ph = Math.min(dna.panellingHeight, p.top);
        solids.push({
          ...place(from, to, 0, ph, PANEL_DEPTH, -PANEL_DEPTH / 2),
          material: 'panelling',
          collide: false,
        });
        if (p.top > dna.panellingHeight + RAIL_HEIGHT) {
          solids.push({
            ...place(
              from,
              to,
              dna.panellingHeight,
              dna.panellingHeight + RAIL_HEIGHT,
              RAIL_DEPTH,
              -RAIL_DEPTH / 2,
            ),
            material: 'rail',
            collide: false,
          });
        }
      }
    }
  };

  // Start room.
  wall('z', start.z1, start.x0, start.x1, 1);
  wall('z', start.z0, start.x0, start.x1, -1, [corridorGap]);
  wall('x', start.x0, start.z0, start.z1, -1, [windowGap]);
  wall('x', start.x1, start.z0, start.z1, 1);
  // Corridor.
  wall('x', corridor.x0, corridor.z0, corridor.z1, -1);
  wall('x', corridor.x1, corridor.z0, corridor.z1, 1);
  // Door room.
  wall('z', doorRoom.z1, doorRoom.x0, doorRoom.x1, 1, [corridorGap]);
  wall('z', doorRoom.z0, doorRoom.x0, doorRoom.x1, -1, [doorGap]);
  wall('x', doorRoom.x0, doorRoom.z0, doorRoom.z1, -1);
  wall('x', doorRoom.x1, doorRoom.z0, doorRoom.z1, 1);

  // Floor and ceiling slabs over the whole footprint.
  const minZ = doorRoom.z0 - t - LIGHT_BOX_DEPTH;
  const maxZ = start.z1 + t;
  const span = { x: W + 2 * t, z: maxZ - minZ };
  const midZ = (minZ + maxZ) / 2;
  solids.push({
    centre: { x: 0, y: -0.1, z: midZ },
    size: { x: span.x, y: 0.2, z: span.z },
    material: 'floor',
    collide: true,
  });
  solids.push({
    centre: { x: 0, y: H + 0.1, z: midZ },
    size: { x: span.x, y: 0.2, z: span.z },
    material: 'ceiling',
    collide: true,
  });

  // Window: frame on the room side, and a pane that blocks the opening.
  const wx = start.x0;
  const fw = 0.08;
  const winH = WINDOW.top - WINDOW.sill;
  const trimDepth = 0.05;
  const tx = wx + trimDepth / 2;
  solids.push(
    {
      centre: { x: tx, y: WINDOW.sill + winH / 2, z: windowGap.from - fw / 2 },
      size: { x: trimDepth, y: winH + 2 * fw, z: fw },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: tx, y: WINDOW.sill + winH / 2, z: windowGap.to + fw / 2 },
      size: { x: trimDepth, y: winH + 2 * fw, z: fw },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: tx, y: WINDOW.top + fw / 2, z: windowCentreZ },
      size: { x: trimDepth, y: fw, z: WINDOW.width },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: wx + 0.06, y: WINDOW.sill - 0.02, z: windowCentreZ },
      size: { x: 0.12, y: 0.04, z: WINDOW.width + 0.2 },
      material: 'trim',
      collide: false,
    },
    // Glazing bars: a single cross, enough to read as a window.
    {
      centre: { x: wx - t / 2, y: WINDOW.sill + winH / 2, z: windowCentreZ },
      size: { x: 0.04, y: winH, z: 0.04 },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: wx - t / 2, y: WINDOW.sill + winH * 0.62, z: windowCentreZ },
      size: { x: 0.04, y: 0.04, z: WINDOW.width },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: wx - t * 0.75, y: WINDOW.sill + winH / 2, z: windowCentreZ },
      size: { x: 0.02, y: winH, z: WINDOW.width },
      material: 'window',
      collide: true,
    },
  );

  // Door architrave on the room side.
  const arch = 0.12;
  const dw = dna.doorWidth;
  const dh = dna.doorHeight;
  const az = doorWallZ + trimDepth / 2;
  solids.push(
    {
      centre: { x: -dw / 2 - arch / 2, y: dh / 2, z: az },
      size: { x: arch, y: dh, z: trimDepth },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: dw / 2 + arch / 2, y: dh / 2, z: az },
      size: { x: arch, y: dh, z: trimDepth },
      material: 'trim',
      collide: false,
    },
    {
      centre: { x: 0, y: dh + arch / 2, z: az },
      size: { x: dw + 2 * arch, y: arch, z: trimDepth },
      material: 'trim',
      collide: false,
    },
  );
  // The doorway stays sealed in Phase 4: the transition decides what lies beyond (Phase 7).
  const leafThickness = 0.06;
  const faceZ = doorWallZ - 0.02;
  solids.push({
    centre: { x: 0, y: dh / 2, z: faceZ - leafThickness / 2 },
    size: { x: dw, y: dh, z: leafThickness },
    material: 'none',
    collide: true,
  });

  const lightBox = {
    centre: { x: 0, y: dh / 2 + 0.2, z: doorWallZ - t - LIGHT_BOX_DEPTH / 2 },
    size: { x: dw + 0.6, y: dh + 0.4, z: LIGHT_BOX_DEPTH },
  };

  const door: DoorLayout = {
    id: 'door-1',
    hinge: { x: -dw / 2, y: 0, z: faceZ },
    width: dw,
    height: dh,
    thickness: leafThickness,
    faceZ,
    lightBox,
  };

  const house = House.parse({
    houseId,
    seed,
    dna,
    rooms: [
      {
        id: 'start-room',
        kind: 'ROOM',
        min: { x: start.x0, y: 0, z: start.z0 },
        max: { x: start.x1, y: H, z: start.z1 },
      },
      {
        id: 'corridor',
        kind: 'CORRIDOR',
        min: { x: corridor.x0, y: 0, z: corridor.z0 },
        max: { x: corridor.x1, y: H, z: corridor.z1 },
      },
      {
        id: 'door-room',
        kind: 'ROOM',
        min: { x: doorRoom.x0, y: 0, z: doorRoom.z0 },
        max: { x: doorRoom.x1, y: H, z: doorRoom.z1 },
      },
    ],
    doors: [
      {
        id: door.id,
        type: 'PRIVATE_WORLD',
        state: 'CLOSED',
        roomId: 'door-room',
        position: { x: 0, y: 0, z: faceZ },
        facing: 0,
      },
    ],
    // 2 m in from the back wall, facing the corridor (-Z).
    spawn: { roomId: 'start-room', position: { x: 0, y: 0, z: start.z1 - 2 }, facing: 0 },
  });

  return {
    house,
    solids,
    door,
    window: {
      centre: { x: wx - t * 0.75, y: WINDOW.sill + winH / 2, z: windowCentreZ },
      width: WINDOW.width,
      height: winH,
    },
    lamp: { base: { x: dw / 2 + 0.9, y: 0, z: doorWallZ + 0.55 }, height: 1.7 },
    windowLightFrom: { x: wx - 4, y: 5, z: windowCentreZ + 0.5 },
  };
}
