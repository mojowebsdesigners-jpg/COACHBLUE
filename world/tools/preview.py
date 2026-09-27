"""Render a GLB from a few angles so a model can be checked without a browser.

    blender -b --factory-startup -P tools/preview.py -- <model.glb> <out_dir> [name]

Three-quarter, front and side views under a neutral studio rig, sized to the
model's own bounding box so the framing works whatever scale it exports at.
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MODEL, OUT = argv[0], argv[1]
NAME = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(MODEL))[0]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=MODEL)

# ---------------------------------------------------------------- framing
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
centre = (lo + hi) / 2
size = max((hi - lo)[i] for i in range(3)) or 1
FRAME = float(os.environ.get("PREVIEW_FRAME", "1.35"))
print("BOUNDS", [round(v, 3) for v in (hi - lo)])

# ---------------------------------------------------------------- lighting
world = bpy.data.worlds.new("W")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.065, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0


def lamp(name, loc, energy, size_):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = energy
    d.size = size_
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = centre + Vector(loc) * size
    direction = (centre - o.location).normalized()
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


lamp("key", (-1.1, -1.5, 1.2), 110 * size * size, size * 0.9)
lamp("fill", (1.6, -0.9, 0.3), 34 * size * size, size * 1.4)
lamp("rim", (0.4, 1.8, 1.0), 70 * size * size, size)

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 85
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in \
    [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = int(os.environ.get("PREVIEW_W", "620"))
scene.render.resolution_y = int(os.environ.get("PREVIEW_H", "860"))
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"

ALL = {
    "front": (0, -1, 0.06),
    "side": (-1, -0.12, 0.06),
    "three": (-0.85, -1.0, 0.35),
}
want = os.environ.get("PREVIEW_VIEWS", "front,side,three").split(",")
VIEWS = {k: v for k, v in ALL.items() if k in want}
for view, dirv in VIEWS.items():
    v = Vector(dirv).normalized()
    cam.location = centre + v * size * FRAME
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"{NAME}_{view}.png")
    bpy.ops.render.render(write_still=True)
    print("SHOT", scene.render.filepath)
