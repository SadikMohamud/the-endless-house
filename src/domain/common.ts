import { z } from 'zod';

/** Opaque identifier. Kept to a safe character set so ids can appear in URLs and logs. */
export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid id');
export type Id = z.infer<typeof Id>;

/** Metres (or metres per second squared for vectors such as gravity). */
export const Vec3 = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
export type Vec3 = z.infer<typeof Vec3>;

/** A colour written as `#RRGGBB`. */
export const HexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'expected #RRGGBB');
export type HexColour = z.infer<typeof HexColour>;
