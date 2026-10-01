# THE ENDLESS HOUSE: Experience Brief (Milestone 1)

<purpose>

This brief is the companion to THE_ENDLESS_HOUSE_MASTER_PROMPT.md.

- The master prompt says **how to build** the House.
- This brief says **what it should feel like**.

Use it for every decision about look, sound, pacing, layout and interaction. Where the two documents conflict, the master prompt wins. Nothing here expands Milestone 1 scope. Where this brief describes something that belongs to a later phase, it is marked **(later)** and is design intent only.

</purpose>

---

<the_feeling>

## 1. The feeling

> **You are somewhere you should not be, and it is very quiet.**

The tone is calm unease. Curiosity, not fear. Awe, and a sense that something is slightly wrong.

This is not a horror game. There are no jump scares, no creatures, no gore and no threat in Milestone 1. The unease comes from stillness, scale and small details that do not add up.

</the_feeling>

---

<design_principles>

## 2. Design principles

1. **Quiet first.** Silence and restraint make small things loud. When in doubt, remove.
2. **Ordinary, then wrong.** The House must look believable. Only then does one wrong detail land.
3. **Nothing explains itself.** No narrator, no lore text, no signs, no tutorial beyond a minimal control hint.
4. **Light leads.** Guide the visitor with light and sightlines, never arrows, markers or UI.
5. **Slow.** Walking pace in the House. The visitor should have time to look.
6. **The door is the moment.** Everything in the House builds towards opening it.

</design_principles>

---

<the_house>

## 3. The House

### 3.1 Character

An old, large, well-kept family house with nobody in it. Late nineteenth to early twentieth century domestic interior, stripped of people and clutter. Tall ceilings, panelled lower walls, plaster above, dark timber floors.

It should feel like a real building someone lived in and left recently, not a themed set.

### 3.2 Starting House DNA values

Use these as the initial House DNA. They are tuning values, not fixed law.

| Property | Value | Note |
|---|---|---|
| Ceiling height | 4.2 m | Tall, but domestic |
| Corridor width | 2.2 m | Generous, slightly too wide |
| Door size | 1.0 m × 2.4 m | Noticeably taller than a normal door. Subtle wrongness |
| First room | 8 m × 10 m | Starting room |
| Corridor length | 14 m | Long enough to feel the walk |
| Eye height | 1.65 m | First-person camera |
| Panelling height | 1.1 m | Dado rail line |

### 3.3 Palette and materials

| Element | Colour | Material feel |
|---|---|---|
| Plaster walls | `#D8D2C4` | Matte, faint unevenness |
| Panelling | `#4A5A52` | Muted green-grey, low sheen |
| Floor | `#3B2A20` | Dark oak boards, soft roughness variation |
| Door | `#2A1E17` | Heavy dark timber |
| Metal fittings | `#B08D57` | Aged brass, dull |

Simple procedural or flat materials are fine for Milestone 1. Consistency matters more than detail.

### 3.4 Lighting

The time is always dusk.

- **Cold source:** one tall window with pale blue evening light, `#8FA6C8`.
- **Warm source:** one lamp near the door, `#FFB36B`.
- Everything else sits in soft shadow.
- **The door is the best-lit object in the House.** A thin line of light leaks from underneath it. No other door does this.

### 3.5 Layout for Milestone 1

```text
[ START ROOM ] ---- 14 m corridor ---- [ DOOR ROOM ]
   visitor                                  the door,
   starts here,                             on axis,
   facing the                               lit by the
   corridor                                 warm lamp
```

- The visitor starts in the first room, facing the corridor.
- The door sits at the far end of the second room, on the same axis as the corridor, so it is visible from the corridor mouth.
- The window is in the start room.

### 3.6 Wrongness

Use one or two of these, no more. They must be subtle enough to doubt.

- The window shows only pale fog. Nothing beyond it.
- A wall clock with no hands.
- The corridor is slightly longer than the rooms either side suggest.
- A door-shaped outline on a wall, painted over.
- The doors are too tall (already built into the House DNA).

### 3.7 Sound (later)

Audio is a later phase in the master prompt. Silence is acceptable and intended for Milestone 1. When audio arrives, the target is:

- A low, almost inaudible room tone.
- The visitor's own footsteps on timber.
- A faint clock tick somewhere out of sight.
- Nothing else. No music.

</the_house>

---

<the_door>

## 4. The door

- Plain, heavy, dark timber with a brass handle.
- Light leaks from underneath. Its colour can hint at the destination (seed-dependent).
- **Interaction range:** within 1.5 m, while looking at it.
- **Affordance:** the centre dot gently brightens and a small `E` glyph appears. No banner, no "Press E to open" text.
- **Opening:** a slow swing of about 1.2 s. Light floods out before the visitor can see through.

</the_door>

---

<the_transition>

## 5. The transition

This is not a loading screen.

1. The door opens and a soft bright haze fills the view.
2. The House fades out behind it (about 1.5 s).
3. The world is generated behind the haze. If generation takes longer, the haze simply holds. No spinner and no progress bar.
4. The visitor arrives in the world facing away from the way out, so the first thing they see is the world, not the exit.

### 5.1 The way back

- Somewhere in the forest stands a lone door frame, attached to nothing.
- It is visible from a distance but not obvious. It is placed in a clearing.
- Walking through it returns the visitor to the House corridor via the same haze.
- **(later)** On return, the House may be very slightly different. Not in Milestone 1.

</the_transition>

---

<the_forest>

## 6. The forest (first world)

### 6.1 Character

Stillness, scale and mist. Tall, straight trunks with sparse undergrowth, like the columns of a cathedral. The visitor should feel small.

### 6.2 Palette and atmosphere

| Element | Colour |
|---|---|
| Trunks | `#3A332C` |
| Foliage | `#2F4A36` |
| Ground | `#4B4A3A` |
| Fog | `#B9C4C0` |

- Pale, overcast light, or a low sun (the angle is seed-dependent).
- Fog fades distance out at roughly 60 to 80 m.

### 6.3 Minimum generation targets

These make AT-05 and AT-07 testable.

| Property | Target | Seed-dependent |
|---|---|---|
| Terrain size | ~200 m × 200 m | No |
| Terrain relief | Gentle rolling hills, max ~8 m | Shape: yes |
| Tree count | 400 to 900, instanced | Yes |
| Tree placement | Scattered, with gaps | Yes |
| Clearings | 1 to 3 | Count and position: yes |
| Return door frame | Inside one clearing | Position: yes |
| Fog density | Within a fixed range | Yes |
| Light angle | Within a fixed range | Yes |

### 6.4 Edges

The visitor should never hit an obvious wall. At the edges, fog thickens and the terrain rises gently. An invisible collider acts as the final backstop.

### 6.5 Physics feel

- The House is always EARTH gravity.
- The forest's physics profile comes from the seed. If it is LOW_GRAVITY, the visitor should feel it through a floatier, longer jump. Nothing on screen explains why.

</the_forest>

---

<controls_and_ui>

## 7. Controls and UI

Target: desktop for Milestone 1.

| Input | Action |
|---|---|
| Click | Enter (pointer lock) |
| Mouse | Look |
| W A S D | Move |
| E | Interact |
| Space | Jump (worlds only) |
| Shift | Move faster (worlds only) |
| Esc | Release pointer |
| ` (backtick) | Toggle diagnostics overlay (development only) |

- **Walk speed:** 1.5 m/s. With Shift in worlds: 3.0 m/s. The House has no sprint and no jump.
- **Start screen:** black, with "THE ENDLESS HOUSE" set small in the centre and "click to enter" beneath it. Nothing else.
- **HUD:** none. Only a small centre dot.

</controls_and_ui>

---

<what_to_avoid>

## 8. What to avoid

- **Horror clichés:** flickering lights, blood, screams, jump scares, creatures.
- **Explaining the House:** lore text, narrators, notes, signs.
- **Game UI:** health, score, minimap, objective markers, quest text.
- **Saturated colour** and heavy bloom. No "fantasy" glow.
- **Stock-asset clutter:** mismatched props. Use fewer objects, and keep them consistent.
- **Music.** Silence and ambience only.

</what_to_avoid>

---

<tone_touchstones>

## 9. Tone touchstones

Use these for mood only. Never copy their assets, layouts or designs.

- **Vilhelm Hammershøi's interiors:** empty domestic rooms, grey window light, closed doors.
- **House of Leaves:** the dread of a house whose measurements do not add up.
- **Tarkovsky's Stalker:** slowness, quiet, and a place with its own rules.
- **Liminal-space photography:** familiar places made strange by emptiness.

</tone_touchstones>

---

<assumptions>

## 10. Assumptions in this brief

These are starting choices. Change any of them freely.

- The House is a period domestic interior, not a modern or abstract one.
- It is always dusk.
- The forest is tall, misty and cathedral-like, not dense jungle.
- Milestone 1 targets desktop only.
- There is no music at any point.

</assumptions>
