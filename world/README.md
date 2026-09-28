# Coach Blue — the 3D world

An explorable forest built with React Three Fiber. The visitor walks a character
along a trail; each stop on the trail is a section of the coaching site.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

---

## What the visitor does

Load → **ENTER THE JOURNEY** → pick **FREE EXPLORE** or **GUIDED JOURNEY** →
walk. `EXIT 3D` (top right, or `SKIP EXPLORATION` on the mode screen) swaps to a
plain, readable version of the same content and back again.

| | |
|---|---|
| Move | `W A S D` / arrows (hold back to walk backwards) |
| Run | `Shift` |
| Jump | `Space` |
| Interact | `E` (or click the prompt) |
| Map | `M` |
| Journey log | `J` |
| Photo mode | `P` |
| First / third person | `V` |
| Look | drag the mouse |
| Close | `Esc` |

Touch devices get a left thumb stick, drag-to-look, and an `E` button.

**Free explore** leaves everything open and announces places as you find them
(`DISCOVERED — THE TRAINING CAMP`), tracked in the map legend.
**Guided journey** lights the next stretch of trail, shows `JOURNEY 03 / 09`
when a stop begins, and nudges you back (`THE JOURNEY CONTINUES THIS WAY`) if
you wander more than ~26 m off the trail. You are never moved automatically, and
either mode can be switched at any time from the HUD without reloading.

Beyond the trail there are five quiet finds — a notebook on a stump, a standing
stone, a hanging photograph, an overlook, an old training ground — listed in the
journey log once found. Every word on them is Coach Blue's own.

### Settings

The gear icon covers graphics (`AUTO · ULTRA · HIGH · MEDIUM · LOW`), reduced
motion, skip cinematics, ambience and music. AUTO reads the GPU string, memory
and core count, and drops to LOW on software renderers. Everything persists.

**Reduced motion** slows the wind, stops leaves and dust, damps the camera and
disables the scripted camera moves. It defaults on if the OS asks for it.

### Testing shortcuts

`?start=guided` or `?start=free` skips the intro. `?at=x,z` drops the player at
a spot, `?cam=dist,pitch,yaw` sets the camera, `?tier=low` forces a graphics
tier, `?lite=1` drops the locations and weather, and `?nopost=1` turns off
post-processing — all useful when something looks wrong.

---

## The world

The trail runs south (entrance) to north (summit), climbing a mountain at the
end. Everything is generated at load from `src/lib/terrain.ts`, which is the one
source of truth for ground height, the trail spline, the stream and collisions —
the scene, the minimap and the player controller all read from it.

| Stop | What's there |
|---|---|
| Entrance | Gate, sign, arrows to the off-trail areas |
| Coach Blue | Coach doing pull-ups on a rig — `[E] TALK TO COACH BLUE` |
| The Challenge | The client question / coach answer pair, in stone |
| Training Camp | Pull-up bars, three training NPCs, a mirror, statues, a video screen, the four app features |
| Discipline Path | Six monoliths: clarity, accountability, discipline, consistency, execution, results |
| 100 Days | A ring of 100 markers that light as you walk it |
| Transformation Gallery | The ten client photographs in frames; `E` opens the full-screen viewer |
| Coaching Hub | The cabin, the app screens, the four coaching steps |
| Campfire | Reviews, photographs floating around the fire |
| Summit | Coach Blue, the closing lines, and the booking structure |
| Question Cave *(off trail)* | The five FAQs as floating markers |
| Your Goals *(off trail)* | The four client goals, one statue each |

Between the gallery and the hub the trail passes the **transformation timeline**:
START · PLAN · DISCIPLINE · CONSISTENCY · CHECK-IN · PROGRESS · RESULT.

Arriving at Coach Blue, the 100 Days ring, the gallery and the hub plays a short
camera move once, with cinematic bars; the summit gets a slow orbit. They can be
turned off in settings, and control returns immediately afterwards.

The CTA at the summit is a structure with doors that open as you approach.
Inside is a short form that hands the details to Coach Blue's real inquiry
page — nothing is stored here.

Day time is driven by trail progress: morning at the entrance, midday in the
forest, sunset by the campfire, sunrise on the summit (`src/lib/dayCycle.ts`).

---

## Content

All copy lives in `src/data/` and is taken verbatim from coach-blue.com and the
100 Days of Discipline page — see `../docs/BRAND-EXTRACTION.md`. Edit these
files, not the components.

`coach.ts` · `programs.ts` (100 days, process, app, pillars) · `faq.ts` ·
`transformations.ts` · `testimonials.ts` · `links.ts` · `journey.ts` (where
things stand in the world and the guided order).

Two content notes:

- **Testimonials are empty on purpose.** The live site publishes its reviews as
  before/after photographs with no quotes or names, so nothing is invented. Add
  approved quotes to `testimonials.ts` and they appear at the campfire and in
  the classic view.
- **App screenshots are missing.** The two mockups on the original site are not
  in any archive snapshot, so the hub screens show feature names. Drop images
  into `public/img` and use them in `CoachingHub`.

Every CTA points at the real inquiry form
(`inspireonlinecoaching.com/coaching/`), as the original buttons did.

---

## Models

`public/models/` — all generated with Hyper3D Rodin, then compressed with
gltf-transform (meshopt + 1024px WebP textures). 7.4 MB total, down from ~180 MB.

| File | Notes |
|---|---|
| `coach.glb` | The playable character, built in Blender by `tools/coach/` (below): rigged, with idle / walk / run / agree / headShake. The previous Hyper3D coach is kept at `raw/coach-previous.glb` |
| `calisthenics.glb`, `cabin.glb`, `campfire.glb`, `boulder.glb` | Props; the boulder is also instanced as scattered rocks |
| `statue-*.glb` | The six original poses, used as statues |

Trees, grass, terrain, water, the bridge, the pull-up bars and the monoliths are
generated in code, so they cost almost nothing to download and can sway in the
wind.

### Rigging the character

`coach.glb` was a static, posed mesh. `tools/rig.py` fits the Mixamo skeleton
from three.js's Xbot sample onto a generated A-pose body, binds it, straightens
the arms into a T-pose and exports with the animation clips:

```bash
blender -b --factory-startup -P tools/rig.py -- raw/coach-apose.glb Xbot.glb out.glb [preview_dir]
```

### World systems added (September 2026)

| System | Where | Notes |
|---|---|---|
| Swimming | `systems/Swim.ts`, `PlayerController.ts` | Deep water (lake, pool, stream channel) floats him: crawl when moving, treading water when still, splash sounds |
| Lake and pool | `lib/terrain.ts` (`LAKE`, `POOL`, `waterSurfaceAt`), `components/3d/Water.tsx` | Lake ~3 m deep; 16 x 7 m tiled lap pool, 1.1–2.2 m |
| The cross | `components/3d/Cross.tsx`, `systems/Carry.ts` | E lifts it, carried like a landmine bar; Space presses; E sets it down |
| Headset radio | `lib/radio.ts`, `components/3d/Headset.tsx`, `ui/RadioCard.tsx` | H toggles; `,` `.` skip. Original R&B instrumentals played live by a synth band, plus any files in `/music` |
| Solid world | `lib/terrain.ts` | Box and circle colliders; props, gym kit, car and people are all solid |
| Outdoor gym | `components/3d/OutdoorKit.tsx`, `GymAmbience.tsx` | Green steel rig, plate-loaded machines, curved treadmill, wood-chip border, ambience |
| Clients | `tools/coach/profile.py` | `CB_PROFILE=client-a|client-b|client-c` builds each through the Coach Blue pipeline |
| Performance | `lib/freeze.ts`, `Frozen.tsx`, `DistanceCull.tsx`, `PerformanceWatch.tsx` | Static freezing and batching, distance culling, adaptive resolution, cached terrain heights |

Profiling switches: `?off=trees,grass,camp,gym,people,billboards,...` turns single systems off.

### The car (`tools/car/`)

`public/models/car.glb` is an original GT coupe built entirely in Blender by
`tools/car/` — no manufacturer's design. It replaces the old `supercar.glb`.

| Module | What it makes |
|---|---|
| `body.py` | The shell: ~45 lofted cross-sections, subdivided, with creased character lines; glass split into its own object; arches and door shut lines cut through the panels; thickened with a dark inside |
| `parts.py` | Flush lamps (lens cut from the body surface, reflector bowl, projectors, DRL blade, full-width tail bar), honeycomb intakes, carbon skirts/splitter/diffuser, quad exhausts, arch liners, mirrors, handles, bonnet/boot shut lines, plates and lettering |
| `wheels.py` | Lathed tyres with grooves and sipes, 19" split ten-spoke rims, discs, red callipers |
| `interior.py` | Bucket seats, dash with screens, console, door cards, a separate steering wheel, and the game's markers |
| `export.py` | Joins the static parts, keeps the animated/marker nodes, writes the GLB |

```bash
blender -b --factory-startup -P tools/car/build.py -- raw/car/car.blend <shots_dir> glb=raw/car/car.glb
npx gltf-transform optimize raw/car/car.glb public/models/car.glb --compress meshopt     --texture-compress webp --simplify false --join false --flatten false     --instance false --palette false --prune false
```

The last four flags matter: without them gltf-transform merges the materials
(the game switches the brake and head lights by material name) and prunes the
empty marker nodes the driver is seated from. Nodes the game reads:
`Wheel_{FL,FR,RL,RR}` (steer) and `…_Spin` (roll), `SteeringWheel` with
`Grip_L`/`Grip_R`, `Seat_Driver`, `Pedals`, `Door_Driver`, `Lamp_Head_*`.

`src/components/3d/Driver.tsx` seats the player by moving him until his hip
bone is on `Seat_Driver`, then solves his hands onto the grips (which turn
with the wheel) and his right foot onto the pedal.

### The Coach Blue hero character (`tools/coach/`)

Built from the reference photo `../assets/img/coach-cutout.webp` on a
MakeHuman/MPFB2 scan body (needs Blender 4.2 with the MPFB add-on installed; do
not pass `--factory-startup` to the first two commands). Each stage is its own
module, and everything rebuilds from `body.blend` in one run:

| Stage | What it makes |
|---|---|
| `body.py` | The shaped body and rig: macros plus ~50 targets for his arms, chest, V-taper, neck and face |
| `skin.py` | Random-walk SSS skin; lips, redness, joint and scalp masks; pore, line and undulation bump |
| `eyes.py` | Eyeball (sclera, veins, iris fibres, pupil) under a separate refractive cornea |
| `hair.py` | Strand hair: clumped coils on top, skin fade, brows, lashes, stubble |
| `clothes.py` | Shirt and cargo pants as garment meshes off the body (ease, bridging, folds, seams, stitching, logo, pocket), trainers with soles |
| `necklace.py` | Curb chain of individual links resting on the neck and collar, and the cross |
| `pose.py` | The reference pose: arms crossed, weight on one leg |
| `stage.py` | Studio lights, grey sweep, front / three-quarter / close-up cameras |

```bash
python tools/coach/make_logo.py raw/coach_hero/tex/logo.png
blender -b -P tools/coach/body.py -- raw/coach_hero/body.blend
blender -b raw/coach_hero/body.blend -P tools/coach/build.py -- \
    raw/coach_hero/coach_hero.blend <shots_dir> engine=CYCLES samples=64 res=720x1280
# game version: bake, fit the Mixamo skeleton onto MakeHuman's weights, export
blender -b raw/coach_hero/coach_hero.blend -P tools/coach/export_game.py -- \
    raw/coach_hero/coach_rigged.glb raw/coach_hero/tex xbot=raw/Xbot.glb
npx gltf-transform optimize raw/coach_hero/coach_rigged.glb public/models/coach.glb \
    --compress meshopt --texture-compress webp --texture-size 1024 --simplify false
```

`export_game.py` does not use `rig.py`'s bone-heat binding: it poses the
MakeHuman rig into Xbot's rest shape, moves each Xbot joint onto the matching
MakeHuman joint (keeping Xbot's bone orientations, so the clips apply
unchanged) and renames MakeHuman's own weight groups to the Mixamo bones.
Materials named `CB_*` keep their authored settings in `useCoachModel`.

Pull-ups, push-ups and squats are not clips — they are solved at runtime with
two-bone IK (`src/lib/ik.ts`) so hands stay on the bar or the floor while the
body moves. More clips (Mixamo exports on the same skeleton) can be added to the
GLB and played by name.

---

## Sound

All of it is synthesised in the browser — there are no audio files. Wind and
birds run everywhere; water and fire fade in by distance; footsteps change with
the surface underfoot (grass, dirt, the wooden bridge); and a quiet three-layer
score opens up as the journey progresses. Audio only starts after the first
click, as browsers require.

## If something fails

No raw errors ever reach the visitor. Without WebGL they get a short note and
the standard site; if the 3D scene throws or the GL context is lost, the app
switches to the same readable site; a video that won't play falls back to a
still.

Search engines and no-JS visitors get the full copy as semantic HTML in
`index.html` (plus `ProfessionalService` structured data). The app removes it
on load and serves the same content through EXIT 3D.

## Rendering note

Several systems (IK, the camera, the cinematics) run in `useFrame` with a
priority, which in React Three Fiber means the app owns the render loop. When
post-processing is off, `RenderPass` in `App.tsx` is what actually draws the
scene — remove it and the canvas goes black on MEDIUM and LOW.

## Performance

Locations mount only when the player is within 70–95 m and unmount again.
Trees, rocks and grass are instanced; grass follows the player. The graphics tier scales tree, grass, rock,
particle and leaf counts, shadow resolution, draw distance, post-processing and
how early locations stream in; drei's `AdaptiveDpr` lowers resolution if the
frame rate drops.

---

## Systems added in the realism pass (Sep 2026)

| Area | Where | Notes |
|---|---|---|
| Splash | `ui/LoadingScreen.tsx`, `public/video/splash/` | Six silent 8 s reels cut from `../assets/video/clip1-6` (ffmpeg, 24 fps, no audio). CSS-driven so it plays while the world compiles; the canvas renders on demand behind it. |
| Performance | `lib/instanceCull.ts`, `3d/ShaderGate.tsx`, `3d/LightPool.tsx` | Per-instance frustum culling for scattered vegetation; new objects are held off-layer until their shaders compile asynchronously; all local lights share a fixed pool of 4 point lights (lamps register with `registerLamp`) so the light count never changes. |
| Activities | `systems/Workout.ts`, `systems/ExercisePose.ts`, `data/exercises.ts` | One station system for gym kit, seats (`sit`/`lounge`), boulder push and rope climb. Enter/leave blend, Space-driven reps with timing bonus, treadmill speed on W/S. `track` stations move as they are worked. |
| Hands | `systems/HandAction.ts`, `systems/HandPose.ts`, `3d/Pickups.tsx`, `3d/HeldItem.tsx` | Pick up / eat mushrooms, pick up / drink / put down water. |
| People | `3d/Townsfolk.tsx`, `data/chatter.ts`, `ui/Dialog.tsx` | Walkers, jogger, bench sitters; E to talk; animation LOD by distance. |
| Boot Camp | `3d/BootCamp.tsx`, `systems/Course.ts` | Location `bootcamp`; boulder lane, rope + bell, crawl net, climbing wall, tyre run, cone drill, road hill sprint (timed gates). |
| Coach Blue CTA | `systems/Coaching.ts`, `ui/CoachNudge.tsx` | Rationed "want Coach Blue's help?" offers after activities; COACH ME button; booking opens with the goal chosen. |
| Car | `systems/VehicleController.ts`, `systems/Boarding.ts` (door, turn, sit on the edge, one leg then the other),  `lib/engineSound.ts`, `3d/TireTracks.tsx` | Four-wheel ground fit + suspension, chase camera, door on a hinge (`DoorHinge_L`, built by `tools/car/export.py`), walk-open-duck-close entry, synthesised ignition and V8, tyre tracks off-road. |
| Water | `3d/LakeScene.tsx`, `3d/Underwater.tsx`, `tools/sealife/build.py`, `systems/PlayerController.ts` | Lake 8 m deep; C dive / Space up, breath meter; underwater fog, light absorption, muffled sound, caustics, kelp, coral. Surface shaded by depth (turquoise shallows, deep blue middle, shore foam), sand beach, jetty, reeds, lily pads. Fish, turtle, ray and jellyfish are modelled in Blender: `blender -b --factory-startup -P tools/sealife/build.py -- raw/sealife.glb`, then optimise with `--prune-attributes false`. |
| Outfits | `tools/coach/export_game.py outfits=1`, `3d/Player.tsx` | Skin under the shirt is exported with a `_SHIRT` attribute and discarded while the shirt is on; the shirt is recoloured Coach Blue blue in the shader. K / 👕 / gym lockers switch. Optimise the coach GLB with `--prune-attributes false`. |
| Night | `systems/DevCheats.ts`, `lib/audio.ts` | Developer command (not in the UI): press the backquote key, type the word, Enter. Crickets and owls at night. |

## Play: the Fun Park, Stunt Yard and water games (Sep 2026)

| Area | Where | Notes |
|---|---|---|
| Fun Park | `3d/fun/FunPark.tsx` (+ `Workouts.tsx`, `Leisure.tsx`, `Sports.tsx`, `common.tsx`) | Location `funpark`. Heavy bag, skipping, jacks, burpees, sit-ups, plank, box jumps, battle ropes, tyre flip, sledgehammer, high striker, keepy-uppy, swings, trampoline, dance floor, hula hoop, yoga + meditation, free throws, penalties (A/D aim), mini golf, darts, photo wall. |
| Play modes | `systems/Workout.ts`, `data/exercises.ts` (`mode`) | `reps` (gym), `hold`, `free`, `steps`, `power` (Space starts a swinging meter, Space releases; `sweet` band drawn green; `onRelease` / `onActionEnd`), `custom` (the station steps itself: swing, trampoline, fishing). `dropOut()` leaves a station somewhere else (the cannonball ends in the pool). `showResult()` for the card. |
| HUD | `ui/WorkoutHud.tsx` (`FunHud`) | Meter drawn per frame, live gauge (`station.hud`: line tension), big result pop. |
| Physics | `systems/Physics.ts` | Balls and boxes: gravity, any ground (terrain, platforms), colliders, the car as a pusher, walking dribbles a ball (not while on a station). Bodies sleep when still. |
| Water games | `3d/fun/WaterFun.tsx` | Fishing off the jetty (cast → wait → strike → reel against line tension; weighed catch), stone skimming from the bank (skips, rings on the water), cannonball off a springboard at the pool's deep end (splash score). `splashAt()` for any splash. The jetty is now walkable (a platform). |
| Stunt Yard | `3d/fun/Stunts.tsx` | Location `stunts`, a levelled lot: kicker ramp (distance and air time, best kept), donut ring (handbrake spins counted), car bowling (ten pins, strike detection, reset), crate wall. |
| Car in the air | `systems/VehicleController.ts` | Launches when the ground falls away faster than gravity (ramp lips); ballistic flight, nose follows the arc, landing compresses the springs; `onCarLanding()`. The kerb check tests for a sudden step at the bumper, so ramps are driven up and their sides still block. Teleports carry no vertical speed. |
| Platforms | `lib/terrain.ts` | Boxes may now be ramps (`rise`). Place anything raised with `baseGround()`, never `groundHeight()` (which includes the platform itself). |
| Map | `systems/MapPlaces.ts`, `systems/MapPoints.ts`, `ui/MiniMap.tsx` | Every activity has a map icon; grouped ones (`group`) show once zoomed in past `GROUP_ZOOM`. |
