import { z } from 'zod';
import { HexColour, Id, Vec3 } from './common';
import { Seed } from './seed';

/** The House's architectural identity. Rooms are generated from it so the House stays recognisable. */
export const HouseDNA = z
  .strictObject({
    ceilingHeight: z.number().positive().max(20),
    corridorWidth: z.number().positive().max(20),
    corridorLength: z.number().positive().max(200),
    doorWidth: z.number().positive().max(5),
    doorHeight: z.number().positive().max(10),
    firstRoom: z.strictObject({
      width: z.number().positive().max(100),
      depth: z.number().positive().max(100),
    }),
    panellingHeight: z.number().min(0),
    wallThickness: z.number().positive().max(2),
    palette: z.strictObject({
      plaster: HexColour,
      panelling: HexColour,
      floor: HexColour,
      door: HexColour,
      brass: HexColour,
    }),
    lighting: z.strictObject({
      windowColour: HexColour,
      lampColour: HexColour,
    }),
  })
  .superRefine((d, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (d.doorHeight >= d.ceilingHeight) fail('door must be lower than the ceiling');
    if (d.doorWidth >= d.corridorWidth) fail('door must be narrower than the corridor');
    if (d.panellingHeight >= d.ceilingHeight) fail('panelling must be below the ceiling');
    if (d.corridorWidth >= d.firstRoom.width) fail('corridor must be narrower than the room');
  });
export type HouseDNA = z.infer<typeof HouseDNA>;

/** Starting values from docs/EXPERIENCE_BRIEF.md §3.2 to §3.4. Tuning values, not fixed law. */
export const DEFAULT_HOUSE_DNA: HouseDNA = HouseDNA.parse({
  ceilingHeight: 4.2,
  corridorWidth: 2.2,
  corridorLength: 14,
  doorWidth: 1.0,
  doorHeight: 2.4,
  firstRoom: { width: 8, depth: 10 },
  panellingHeight: 1.1,
  wallThickness: 0.2,
  palette: {
    plaster: '#D8D2C4',
    panelling: '#4A5A52',
    floor: '#3B2A20',
    door: '#2A1E17',
    brass: '#B08D57',
  },
  lighting: {
    windowColour: '#8FA6C8',
    lampColour: '#FFB36B',
  },
});

export const RoomKind = z.enum(['ROOM', 'CORRIDOR']);

/** Axis-aligned interior volume, in House-local metres. */
export const Room = z
  .strictObject({
    id: Id,
    kind: RoomKind,
    min: Vec3,
    max: Vec3,
  })
  .refine(
    (r) => r.min.x < r.max.x && r.min.y < r.max.y && r.min.z < r.max.z,
    'room min must be below max on every axis',
  );
export type Room = z.infer<typeof Room>;

// Only the door types Milestone 1 uses: the House door and the forest's way back.
export const DoorType = z.enum(['PRIVATE_WORLD', 'REAL_RETURN']);
export type DoorType = z.infer<typeof DoorType>;

export const DoorState = z.enum(['CLOSED', 'OPENING', 'OPEN']);
export type DoorState = z.infer<typeof DoorState>;

export const Door = z.strictObject({
  id: Id,
  type: DoorType,
  state: DoorState,
  /** Room the door stands in. */
  roomId: Id,
  /** Centre of the door's base. */
  position: Vec3,
  /** Direction the closed door faces, radians about the vertical axis. */
  facing: z.number(),
});
export type Door = z.infer<typeof Door>;

export const House = z
  .strictObject({
    houseId: Id,
    seed: Seed,
    dna: HouseDNA,
    rooms: z.array(Room).min(1),
    doors: z.array(Door),
    spawn: z.strictObject({ roomId: Id, position: Vec3, facing: z.number() }),
  })
  .superRefine((h, ctx) => {
    const roomIds = new Set(h.rooms.map((r) => r.id));
    if (roomIds.size !== h.rooms.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate room id' });
    if (!roomIds.has(h.spawn.roomId))
      ctx.addIssue({ code: 'custom', message: 'spawn references an unknown room' });
    for (const door of h.doors) {
      if (!roomIds.has(door.roomId))
        ctx.addIssue({ code: 'custom', message: `door ${door.id} references an unknown room` });
    }
  });
export type House = z.infer<typeof House>;
