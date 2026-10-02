import type { HouseDNA } from '../domain';
import { planWorld } from '../gen/planner';
import type { Rapier } from '../platform/physics';
import type { Engine } from '../runtime/engine';
import { ForestStage } from '../stages/forest-stage';
import { HouseStage } from '../stages/house-stage';
import { buildDestination, type WorldPlanner } from './destination';
import type { JourneyEngine } from './engine';

/** From the experience brief §5: the House fades out behind the haze in about 1.5 s. */
export const HAZE_SECONDS = 1.5;
const RETURN_FRAME_ID = 'return-frame';
const FALLBACK_LIGHT = '#FFE6C4';

export interface ExperienceUi {
  /** Full-screen overlay; its opacity transition must last HAZE_SECONDS. */
  haze: HTMLElement;
  setFocus: (inReach: boolean) => void;
}

export type Phase = 'house' | 'to-world' | 'world' | 'to-house';

/**
 * Runs the journey in the browser: House, door, haze, world, frame, haze, House.
 * Every location change goes through the JourneyEngine; stages only report what happened.
 */
export class Experience {
  phase: Phase = 'house';
  stage: HouseStage | ForestStage;
  /** Message from the most recent generation failure, if any. */
  lastFailure: string | null = null;

  constructor(
    private readonly rapier: Rapier,
    private readonly engine: Engine,
    private readonly dna: HouseDNA,
    private readonly houseSeed: string,
    readonly journey: JourneyEngine,
    private readonly ui: ExperienceUi,
    private readonly planner: WorldPlanner = planWorld,
  ) {
    this.stage = this.makeHouse('start');
    engine.setStage(this.stage);
  }

  private makeHouse(arrival: 'start' | 'corridor'): HouseStage {
    const door = this.houseDoor();
    let doorLight = FALLBACK_LIGHT;
    try {
      // The light under the door hints at where it currently leads.
      doorLight = this.planner(this.journey.peekDoor(door.id, door.roomId)).lightingProfile
        .sunColour;
    } catch {
      // A planning failure here only costs the hint; opening the door handles it properly.
    }
    return new HouseStage(
      this.rapier,
      this.dna,
      this.houseSeed,
      {
        onFocusChange: this.ui.setFocus,
        onDoorOpened: (id) => void this.throughDoor(id),
        onRoomChange: (roomId) => {
          if (this.phase === 'house') this.journey.moveToRoom(roomId);
        },
      },
      { doorLight, arrival },
    );
  }

  private houseDoor() {
    // Milestone 1 has one door; its id and room are fixed by the layout.
    return { id: 'door-1', roomId: 'door-room' };
  }

  private async throughDoor(doorId: string): Promise<void> {
    if (this.phase !== 'house' || !(this.stage instanceof HouseStage)) return;
    const house = this.stage;
    const roomId = house.layout.house.doors.find((d) => d.id === doorId)?.roomId ?? 'door-room';
    const { seeds, worldId } = this.journey.openDoor(doorId, roomId);
    this.phase = 'to-world';
    this.engine.inputEnabled = false;
    this.ui.setFocus(false);

    // Let the door begin to swing, then the haze fills the view.
    await wait(400);
    let colour = FALLBACK_LIGHT;
    try {
      colour = this.planner(seeds).lightingProfile.sunColour;
    } catch {
      // handled below by buildDestination
    }
    await this.haze(1, colour);

    let destination;
    try {
      destination = buildDestination(
        seeds,
        { worldId, journeyId: this.journey.journey.journeyId },
        this.dna,
        this.planner,
      );
    } catch (err) {
      // Never leave the visitor stuck at a door: fall back to the House.
      this.lastFailure = err instanceof Error ? err.message : String(err);
      console.warn('world generation failed; returning to the House:', this.lastFailure);
      this.journey.abortToHouse(roomId);
      house.door.reset();
      this.phase = 'house';
      await this.haze(0);
      this.engine.inputEnabled = true;
      return;
    }

    const forest = new ForestStage(this.rapier, destination.reality, destination.forest, this.dna, {
      onReturn: () => void this.throughFrame(),
    });
    this.engine.setStage(forest); // disposes the House stage
    this.stage = forest;
    this.journey.enterWorld(worldId);
    this.phase = 'world';
    await this.framesRendered(2); // the haze holds through first-frame shader compilation
    await this.haze(0);
    this.engine.inputEnabled = true;
  }

  private async throughFrame(): Promise<void> {
    if (this.phase !== 'world' || !(this.stage instanceof ForestStage)) return;
    const colour = this.stage.reality.lightingProfile.sunColour;
    this.journey.leaveWorld(RETURN_FRAME_ID);
    this.phase = 'to-house';
    this.engine.inputEnabled = false;
    await this.haze(1, colour);

    const house = this.makeHouse('corridor');
    this.engine.setStage(house); // disposes the forest stage
    this.stage = house;
    this.journey.enterHouse(house.layout.corridorArrival.roomId);
    this.phase = 'house';
    await this.framesRendered(2);
    await this.haze(0);
    this.engine.inputEnabled = true;
  }

  private async haze(opacity: 0 | 1, colour?: string): Promise<void> {
    if (colour) this.ui.haze.style.backgroundColor = colour;
    this.ui.haze.style.opacity = String(opacity);
    await wait(HAZE_SECONDS * 1000 + 50);
  }

  private async framesRendered(count: number): Promise<void> {
    const target = this.engine.frames + count;
    while (this.engine.frames < target) await wait(16);
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
