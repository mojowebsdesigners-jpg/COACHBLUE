"""Build the Coach Blue GT coupe.

    blender -b --factory-startup -P tools/car/build.py -- <out.blend> <shots_dir> \\
        [stages=body,parts,wheels,interior] [engine=EEVEE|CYCLES] [samples=64] [res=1280x720]
        [glb=<out.glb>]
"""
import bpy, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import common
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, SHOTS = os.path.abspath(argv[0]), os.path.abspath(argv[1])
opts = dict(a.split("=", 1) for a in argv[2:])
STAGES = opts.get("stages", "body,parts,wheels,interior").split(",")
ENGINE = opts.get("engine", "EEVEE")
SAMPLES = int(opts.get("samples", "64"))
RES = tuple(int(x) for x in opts.get("res", "1280x720").split("x"))
VIEWS = opts.get("views", "front34,side,rear34").split(",")
os.makedirs(SHOTS, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
pal = common.mats()
car = common.collection("CAR")
ctx = {"col": car, "pal": pal}

for stage in STAGES:
    t = time.time()
    mod = importlib.import_module(stage)
    out = mod.build(car, pal) if stage == "body" else mod.build(car, pal, ctx)
    ctx[stage] = out
    print(f"STAGE {stage} {time.time() - t:.1f}s")


# ---------------------------------------------------------------- studio
def studio():
    col = common.collection("STUDIO")
    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # a soft sky gradient so the paint has something to reflect
    tex = world.node_tree.nodes.new("ShaderNodeTexSky")
    tex.sky_type = "HOSEK_WILKIE"
    tex.sun_elevation = math.radians(35)
    tex.turbidity = 3.0
    world.node_tree.links.new(tex.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 0.35

    def area(name, loc, size, energy, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size, d.color = energy, size, color
        o = bpy.data.objects.new(name, d)
        col.objects.link(o)
        o.location = loc
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = (Vector((0, 0, 0.6)) - Vector(loc)).to_track_quat("-Z", "Y")
    # a big softbox overhead is what gives car paint its long clean highlights
    area("Top", (0, 0, 5.5), 7.0, 1800)
    area("Key", (-4.5, -4.5, 3.0), 4.0, 900, (1.0, 0.97, 0.93))
    area("Fill", (5, 2, 2), 4.0, 350, (0.9, 0.95, 1.0))
    area("Rim", (0, 6, 2.5), 4.0, 600)

    bpy.ops.mesh.primitive_plane_add(size=60)
    floor = bpy.context.active_object
    common.link(floor, col)
    fm = common.material("Studio_Floor", "#3b3d40", rough=0.35, spec=0.6)
    floor.data.materials.append(fm)
    cams = {}
    for name, loc, look, lens in (
            ("front34", (-4.6, -5.6, 1.45), (0, -0.2, 0.55), 55),
            ("side", (-7.4, 0, 0.9), (0, 0, 0.62), 55),
            ("rear34", (4.8, 5.4, 1.5), (0, 0.2, 0.6), 55),
            ("front", (0, -8.5, 0.9), (0, 0, 0.62), 60),
            ("interior", (0.3, 0.55, 1.06), (0.35, -1.5, 0.78), 24),
            ("wheel", (-1.9, -2.3, 0.45), (-0.82, -1.35, 0.35), 50),
            ("nose", (1.6, -4.3, 1.05), (0.1, -2.0, 0.6), 50),
            ("noseL", (-1.6, -4.3, 1.05), (-0.1, -2.0, 0.6), 50)):
        d = bpy.data.cameras.new(name)
        d.lens = lens
        o = bpy.data.objects.new("CAM_" + name, d)
        col.objects.link(o)
        o.location = loc
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y")
        cams[name] = o
    return cams


cams = studio()
bpy.ops.wm.save_as_mainfile(filepath=OUT)

scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.resolution_x, scene.render.resolution_y = RES
if ENGINE == "CYCLES":
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
else:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 48
    scene.eevee.use_raytracing = True
for v in VIEWS:
    t = time.time()
    scene.camera = cams[v]
    scene.render.filepath = os.path.join(SHOTS, f"car_{v}.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDER {v} {time.time() - t:.1f}s")

if "glb" in opts:
    import export
    importlib.reload(export)
    export.run(os.path.abspath(opts["glb"]), ctx)
print("DONE")
