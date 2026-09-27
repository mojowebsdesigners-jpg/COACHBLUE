"""Assemble the Coach Blue hero character from the shaped body.

    blender -b raw/coach_hero/body.blend -P tools/coach/build.py -- \\
        <out.blend> <shots_dir> [engine=EEVEE|CYCLES] [cams=Front,ThreeQuarter,CloseUp]
        [stages=skin,eyes,hair,clothes,necklace,pose] [res=900x1600] [samples=96]

Every stage reads only the shaped body and the rig, so any stage can be
changed and the whole character rebuilt from body.blend in one run.
"""
import bpy, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import common
importlib.reload(common)

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, SHOTS = argv[0], argv[1]
opts = dict(a.split("=", 1) for a in argv[2:])
ENGINE = opts.get("engine", "EEVEE")
CAMS = opts.get("cams", "Front,ThreeQuarter,CloseUp").split(",")
STAGES = opts.get("stages", "skin,eyes,hair,clothes,necklace,pose").split(",")
from profile import P as _PROF
if not _PROF["necklace"] and "necklace" in STAGES:
    STAGES.remove("necklace")
RES = tuple(int(x) for x in opts.get("res", "900x1600").split("x"))
SAMPLES = int(opts.get("samples", "96"))
TAG = opts.get("tag", "")
os.makedirs(SHOTS, exist_ok=True)

body = common.body()
height = common.rest_coords(body)[:, 2].max()
print(f"HEIGHT {height:.3f}")

# the professional file layout the brief asks for
root = bpy.context.scene.collection
for name in ("HIGH_POLY", "GAME_MESH", "RIG", "MATERIALS", "LIGHTING", "CAMERAS"):
    common.collection(name)
gm = common.collection("GAME_MESH")
for name in ("BODY", "HEAD", "HAIR", "CLOTHING", "ACCESSORIES"):
    common.collection(name, gm)
common.move_to(body, common.collection("BODY"))
common.move_to(common.rig(), common.collection("RIG"))

for stage in STAGES:
    t = time.time()
    mod = importlib.import_module(stage)
    importlib.reload(mod)
    mod.apply()
    print(f"STAGE {stage} {time.time() - t:.1f}s")

import stage as studio
importlib.reload(studio)
cams = studio.build(height)
bpy.ops.wm.save_as_mainfile(filepath=OUT)

for name in CAMS:
    t = time.time()
    path = os.path.join(SHOTS, f"{name.lower()}{TAG}.png")
    studio.render(cams[f"CAM_{name}"], path, ENGINE,
                  RES if name != "CloseUp" else (RES[0], RES[0]), SAMPLES)
    print(f"RENDER {name} {time.time() - t:.1f}s -> {path}")
print("DONE")
