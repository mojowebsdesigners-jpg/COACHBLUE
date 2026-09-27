"""Stage 1 of the Coach Blue hero build: the body.

    blender -b -P tools/coach_body.py -- <out.blend> [preview_dir]

A MakeHuman/MPFB2 scan base shaped to the reference photograph
(assets/img/coach-cutout.webp). The macros set the broad build; the targets
below do the work the macros cannot: the deltoid cap, the arm mass relative to
the forearm, the pec shelf, the V-taper into a narrow waist, a thick neck, and
the face — wide jaw, broad nose, full lips, strong brow.

Must not run with --factory-startup: it needs the installed MPFB add-on.
"""
import bpy, importlib, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None


def mpfb(module, name):
    for root in ("bl_ext.user_default.mpfb", "mpfb"):
        try:
            return getattr(importlib.import_module(f"{root}.{module}"), name)
        except ImportError:
            continue
    raise ImportError(module)


HumanService = mpfb("services.humanservice", "HumanService")
TargetService = mpfb("services.targetservice", "TargetService")
HumanObjectProperties = mpfb("entities.objectproperties", "HumanObjectProperties")

MACROS = {"gender": 1.0, "age": 0.4, "muscle": 1.0, "weight": 0.64,
          "height": 0.6, "proportions": 0.8,
          "african": 0.55, "asian": 0.2, "caucasian": 0.25}

# signed weights: positive loads the -incr / named target, negative the -decr
TARGETS = {
    # shoulders and arms: the defining feature of the photo
    "upperarm-shoulder-muscle": 1.0,
    "upperarm-muscle": 1.0,
    "upperarm-scale-horiz": 1.0,
    "upperarm-scale-depth": 1.0,
    "upperarm-fat": -0.4,
    "measure-upperarm-circ": 1.0,
    "lowerarm-muscle": 1.0,
    "lowerarm-scale-depth": 0.8,
    "lowerarm-scale-horiz": 0.7,
    "lowerarm-fat": -0.4,
    # torso: pec shelf, lats, V into a narrow waist
    "torso-muscle-pectoral": 1.0,
    "measure-bust-circ": 0.45,
    "measure-frontchest-dist": 0.3,
    "torso-muscle-dorsi": 0.7,
    "torso-vshape": 0.55,
    "measure-shoulder-dist": 0.55,
    "measure-waist-circ": -0.35,
    "measure-hips-circ": -0.35,
    "stomach-tone": 0.6,
    "stomach-pregnant": -0.3,
    # neck: short and thick, traps high
    "measure-neck-circ": 1.0,
    "measure-neck-height": -0.25,
    "neck-scale-horiz": 0.5,
    # legs: thick thighs under loose trousers
    "upperleg-muscle": 0.6,
    "upperlegs-height": -0.3,
    "lowerlegs-height": -0.2,
    "lowerleg-muscle": 0.4,
    "upperleg-fat": -0.2,
    # head and face
    "head-square": 0.5,
    "head-round": 0.3,
    "head-scale-horiz": 0.18,
    "head-fat": 0.1,
    "head-scale-vert": -0.2,
    "chin-width": 0.35,
    "chin-bones": 0.8,
    "chin-prominent": 0.1,
    "chin-height": -0.25,
    "cheek-bones": 0.7,
    "cheek-volume": 0.4,
    "forehead-nubian": 0.25,
    "forehead-temple": 0.2,
    "nose-scale-horiz": 0.5,
    "nose-flaring": 0.4,
    "nose-nostrils-width": 0.3,
    "nose-point-width": 0.6,
    "nose-hump": -0.2,
    "nose-scale-vert": -0.12,
    "mouth-scale-horiz": -0.1,
    "mouth-upperlip-volume": -0.15,
    "mouth-lowerlip-volume": 0.05,
    "mouth-angles-down": 0.25,
    "eye-scale": -0.1,
    "eye-eyefold-down": 0.12,
    "eye-bag": -0.1,
    "eye-height2": 0.25,
}

# who is being built: a client profile replaces the coach's macros and table
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from profile import NAME as PROFILE, P as PROF
MACROS = PROF["macros"]
if PROF["targets"] is not None:
    TARGETS = PROF["targets"]

SIDED = {"upperarm", "lowerarm", "upperleg", "lowerleg", "cheek", "eye"}
LITERAL = ("-down", "-up", "-in", "-out", "-forward", "-backward", "-square", "-round", "-oval")


def target_files(key, value):
    """Map a signed key onto the MakeHuman target file(s) it names."""
    sides = ["l-", "r-"] if key.split("-")[0] in SIDED else [""]
    for side in sides:
        if key.endswith(LITERAL):
            yield side + key, abs(value)
        else:
            yield side + key + ("-incr" if value > 0 else "-decr"), abs(value)


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

human = HumanService.create_human()
human.name = "CB_Body"
for k, v in MACROS.items():
    HumanObjectProperties.set_value(k, v, entity_reference=human)
TargetService.reapply_macro_details(human)

missing = []
for key, value in TARGETS.items():
    for name, w in target_files(key, value):
        path = TargetService.target_full_path(name)
        if not path:
            missing.append(name)
            continue
        TargetService.load_target(human, path, weight=w, name=name)
print("MISSING TARGETS", missing)

# rig it now, so the pose, the garments and the game export all share one skeleton
rig = HumanService.add_builtin_rig(human, "game_engine")
if rig:
    rig.name = "CB_Rig"

h = human.dimensions.z
print(f"BODY verts={len(human.data.vertices)} height={h:.3f}")

bpy.ops.wm.save_as_mainfile(filepath=OUT)


def preview():
    """Grey clay, front and side, framed like the reference photo."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 520, 1000
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.36, 0.38, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

    clay = bpy.data.materials.new("Clay")
    clay.use_nodes = True
    bsdf = clay.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.45, 0.3, 0.22, 1)
    bsdf.inputs["Roughness"].default_value = 0.55
    human.data.materials.clear()
    human.data.materials.append(clay)

    key = bpy.data.lights.new("Key", "AREA")
    key.energy, key.size = 900, 3
    k = bpy.data.objects.new("Key", key)
    scene.collection.objects.link(k)
    k.location = (1.8, -2.5, 2.6)
    k.rotation_euler = (math.radians(55), 0, math.radians(35))
    rim = bpy.data.lights.new("Rim", "AREA")
    rim.energy, rim.size = 500, 2
    r = bpy.data.objects.new("Rim", rim)
    scene.collection.objects.link(r)
    r.location = (-1.8, 2.2, 2.2)
    r.rotation_euler = (math.radians(-60), 0, math.radians(-140))

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = h * 1.08
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for label, angle in (("front", 0), ("side", 90), ("threeq", 40)):
        a = math.radians(angle)
        cam.location = (5 * math.sin(a), -5 * math.cos(a), h * 0.52)
        cam.rotation_euler = (math.radians(90), 0, a)
        scene.render.filepath = os.path.join(PREVIEW, f"body_{label}.png")
        bpy.ops.render.render(write_still=True)
    # a head close-up for the face
    cam_data.ortho_scale = 0.36
    cam.location = (0, -5, h - 0.14)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = 700, 800
    scene.render.filepath = os.path.join(PREVIEW, "body_face.png")
    bpy.ops.render.render(write_still=True)


if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    preview()
print("DONE")
