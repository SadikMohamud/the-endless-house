import * as THREE from 'three/webgpu';
import type { VisualProfileId } from '../domain';

/**
 * A visual reality: how surfaces, sky and fog are drawn. Styles only change materials and
 * colours; geometry, collision and physics are identical in every style, so every world stays
 * genuinely 3D (spec §20).
 */
export interface VisualStyle {
  readonly id: VisualProfileId;
  /** Builds the material for a surface of the given base colour. */
  material(colour: string, options?: { side?: THREE.Side }): THREE.Material;
  /** Sky and fog colour derived from the planned fog colour. */
  atmosphere(fogColour: string): string;
  /** Light colour as this style renders it. */
  light(colour: string): string;
  /** Sides on trunk and crown meshes. Rendering only: colliders are unaffected. Default 7. */
  segments?: number;
  /** Whether crowns receive shadows. Default true. */
  crownsReceiveShadow?: boolean;
}

const luminance = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const grey = (hex: string) => {
  const l = luminance(hex);
  return `#${new THREE.Color(l, l, l).getHexString()}`;
};

const PAPER = '#E9E4D6';

/** A two-step gradient: everything is either lit (paper) or in shade (ink-tinted). */
function twoToneGradient(): THREE.DataTexture {
  const data = new Uint8Array([70, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const VISUAL_STYLES: Readonly<Record<VisualProfileId, VisualStyle>> = {
  NATURAL: {
    id: 'NATURAL',
    material: (colour, o) =>
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.9,
        side: o?.side ?? THREE.FrontSide,
      }),
    atmosphere: (fog) => fog,
    light: (c) => c,
  },
  LOW_POLY: {
    id: 'LOW_POLY',
    material: (colour, o) =>
      new THREE.MeshStandardMaterial({
        // Brighter, more saturated: low-poly reads as a stylised reality, not a cheaper one.
        color: new THREE.Color(colour).offsetHSL(0, 0.18, 0.1),
        roughness: 1,
        flatShading: true,
        side: o?.side ?? THREE.FrontSide,
      }),
    atmosphere: (fog) => `#${new THREE.Color(fog).offsetHSL(0.02, 0.12, 0.06).getHexString()}`,
    light: (c) => c,
    segments: 4,
  },
  MONOCHROME: {
    id: 'MONOCHROME',
    material: (colour, o) =>
      new THREE.MeshStandardMaterial({
        color: grey(colour),
        roughness: 0.95,
        side: o?.side ?? THREE.FrontSide,
      }),
    atmosphere: (fog) => grey(fog),
    light: (c) => grey(c),
  },
  TWO_BIT: {
    id: 'TWO_BIT',
    // Dark surfaces become ink, light ones paper; toon shading splits each into two tones.
    material: (colour, o) =>
      new THREE.MeshToonMaterial({
        color: luminance(colour) > 0.35 ? PAPER : '#8C877C',
        gradientMap: twoToneGradient(),
        side: o?.side ?? THREE.FrontSide,
      }),
    atmosphere: () => PAPER,
    light: () => '#FFFFFF',
    // Two-tone shading already darkens crown undersides; shadow lookups there only add hatching.
    crownsReceiveShadow: false,
  },
  WIREFRAME: {
    id: 'WIREFRAME',
    material: (colour, o) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour).lerp(new THREE.Color('#9FD8C8'), 0.65),
        wireframe: true,
        side: o?.side ?? THREE.FrontSide,
      }),
    atmosphere: () => '#06090A',
    light: (c) => c,
  },
};
