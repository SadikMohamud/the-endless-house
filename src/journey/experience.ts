import type { HouseDNA } from '../domain';
import { planWorld } from '../gen/planner';
import type { Rapier } from '../platform/physics';
import type { Engine } from '../runtime/engine';
import { ForestStage } from '../stages/forest-stage';
import { HouseStage } from '../stages/house-stage';
import { buildDestination, type WorldPlanner } from './destination';
import type { JourneyService } from './service';

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
 * Every location change goes through the JourneyService; stages only report what happened.
 * Any failure (generation, network) leaves the visitor somewhere valid rather than stuck.
 */
export class Experience {
  phase: Phase = 'house';
  /** Message from the most recent failure, if any. */
  lastFailure: string | null = null;

  private constructor(
    private readonly rapier: Rapier,
    private readonly engine: Engine,
    private readonly dna: HouseDNA,
    private readonly houseSeed: string,
    readonly journey: JourneyService,
    private readonly ui: ExperienceUi,
    private readonly planner: WorldPlanner,
    public stage: HouseStage | ForestStage,
  ) {}

  static async create(
    rapier: Rapier,
    engine: Engine,
    dna: HouseDNA,
    houseSeed: string,
    journey: JourneyService,
    ui: ExperienceUi,
    planner: WorldPlanner = planWorld,
  ): Promise<Experience> {
    // The stage is replaced immediately below; a placeholder keeps the constructor simple.
    const experience = new Experience(
      rapier,
      engine,
      dna,
      houseSeed,
      journey,
      ui,
      planner,
      null as unknown as HouseStage,
    );
    experience.stage = await experience.makeHouse('start');
    engine.setStage(experience.stage);
    return experience;
  }

  private async makeHouse(arrival: 'start' | 'corridor'): Promise<HouseStage> {
    let doorLight = FALLBACK_LIGHT;
    try {
      // The light under the door hints at where it currently leads.
      doorLight = await this.journey.doorHint('door-1', 'door-room');
    } catch (err) {
      // Only the hint is lost; opening the door handles failures properly.
      this.fail('door hint unavailable', err);
    }
    return new HouseStage(
      this.rapier,
      this.dna,
      this.houseSeed,
      {
        onFocusChange: this.ui.setFocus,
        onDoorOpened: (id) => void this.throughDoor(id),
        onRoomChange: (roomId) => {
          if (this.phase !== 'house') return;
          this.journey
            .moveToRoom(roomId)
            .catch((err) => this.fail('room change not recorded', err));
        },
      },
      { doorLight, arrival },
    );
  }

  private async throughDoor(doorId: string): Promise<void> {
    if (this.phase !== 'house' || !(this.stage instanceof HouseStage)) return;
    const house = this.stage;
    const roomId = house.layout.house.doors.find((d) => d.id === doorId)?.roomId ?? 'door-room';
    this.phase = 'to-world';
    this.engine.inputEnabled = false;
    this.ui.setFocus(false);

    let opened;
    try {
      opened = await this.journey.openDoor(doorId, roomId);
    } catch (err) {
      // The door would not open (for example the server is unreachable): it closes again.
      this.fail('door did not open', err);
      house.door.reset();
      this.phase = 'house';
      this.engine.inputEnabled = true;
      return;
    }
    const { seeds, worldId } = opened;

    // Let the door begin to swing, then the haze fills the view.
    await wait(400);
    let colour = FALLBACK_LIGHT;
    try {
      colour = this.planner(seeds).lightingProfile.sunColour;
    } catch {
      // handled below by buildDestination
    }
    await this.haze(1, colour);

    let forest: ForestStage;
    try {
      const destination = buildDestination(
        seeds,
        { worldId, journeyId: this.journey.journey.journeyId },
        this.dna,
        this.planner,
      );
      await this.journey.enterWorld(worldId);
      forest = new ForestStage(this.rapier, destination.reality, destination.forest, this.dna, {
        onReturn: () => void this.throughFrame(),
      });
    } catch (err) {
      // Never leave the visitor stuck at a door: fall back to the House.
      this.fail('world could not be entered; staying in the House', err);
      await this.journey.abortToHouse(roomId).catch((e) => this.fail('abort not recorded', e));
      house.door.reset();
      this.phase = 'house';
      await this.haze(0);
      this.engine.inputEnabled = true;
      return;
    }

    this.engine.setStage(forest); // disposes the House stage
    this.stage = forest;
    this.phase = 'world';
    await this.framesRendered(2); // the haze holds through first-frame shader compilation
    await this.haze(0);
    this.engine.inputEnabled = true;
  }

  private async throughFrame(): Promise<void> {
    if (this.phase !== 'world' || !(this.stage instanceof ForestStage)) return;
    const forest = this.stage;
    this.phase = 'to-house';
    this.engine.inputEnabled = false;
    try {
      await this.journey.leaveWorld(RETURN_FRAME_ID);
    } catch (err) {
      // The way back did not answer this time; the frame still stands.
      this.fail('could not leave the world', err);
      forest.allowReturn();
      this.phase = 'world';
      this.engine.inputEnabled = true;
      return;
    }
    await this.haze(1, forest.reality.lightingProfile.sunColour);

    const house = await this.makeHouse('corridor');
    try {
      await this.journey.enterHouse(house.layout.corridorArrival.roomId);
    } catch (err) {
      // The visitor is home either way; the record is marked as out of step.
      this.fail('return to the House not recorded', err);
    }
    this.engine.setStage(house); // disposes the forest stage
    this.stage = house;
    this.phase = 'house';
    await this.framesRendered(2);
    await this.haze(0);
    this.engine.inputEnabled = true;
  }

  private fail(what: string, err: unknown): void {
    this.lastFailure = `${what}: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(this.lastFailure);
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
