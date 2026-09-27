"""Model the gym kit to real dimensions and export one GLB per piece.

    blender -b --factory-startup -P tools/gym_kit.py -- <out_dir>

Everything here is built from measurements rather than generated, so grip
heights, bar heights and seat heights are the real ones the characters' hands
and feet have to meet. Origin is on the floor, +Z up in Blender (+Y up once
exported), and each piece faces -Y (towards the user).
"""
import bpy, bmesh, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0] if argv else "."
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- materials
def material(name, base, rough, metal, clearcoat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = clearcoat
    return m

MATS = {}
def mats():
    if MATS:
        return MATS
    MATS.update({
        "frame": material("GymFrame", (0.035, 0.037, 0.04), 0.42, 0.85),      # powder-coated steel
        "steel": material("GymSteel", (0.62, 0.63, 0.65), 0.22, 1.0),          # chrome bar
        "rubber": material("GymRubber", (0.022, 0.022, 0.024), 0.92, 0.0),     # plates, hex heads
        "pad": material("GymPad", (0.04, 0.042, 0.047), 0.72, 0.0),            # vinyl padding
        "grip": material("GymGrip", (0.05, 0.05, 0.055), 0.85, 0.1),
        "accent": material("GymAccent", (0.11, 0.91, 0.71), 0.45, 0.2),        # brand mint
        "plastic": material("GymPlastic", (0.08, 0.085, 0.09), 0.6, 0.0),
        "screen": material("GymScreen", (0.02, 0.03, 0.035), 0.25, 0.4),
    })
    return MATS


def new_collection_clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats.__globals__["MATS"].clear()


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    # primitive_cube_add(size=1) is already a 1 m cube, so scale by the size itself
    o.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def tube(name, radius, length, loc, mat, axis="Z", verts=16):
    rot = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=length, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o


def bevel(obj, width=0.008, segments=2):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(50)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)


def export(name):
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True)
    print("WROTE", path)


# ---------------------------------------------------------------- pieces
def power_rack():
    """2.3 m uprights, pull-up bar at 2.25 m, J-hooks at 1.45 m (bar height)."""
    new_collection_clear()
    M = mats()
    W, D, H = 1.22, 1.15, 2.30                     # inside width, depth, height
    post = 0.075
    for sx in (-1, 1):
        for sy in (-1, 1):
            o = box(f"post{sx}{sy}", (post, post, H), (sx * W / 2, sy * D / 2, H / 2), M["frame"])
            bevel(o)
    # feet
    for sy in (-1, 1):
        box(f"foot{sy}", (W + 0.3, 0.12, 0.09), (0, sy * D / 2, 0.045), M["frame"])
    # top cross members
    for sy in (-1, 1):
        box(f"top{sy}", (W, 0.07, 0.07), (0, sy * D / 2, H - 0.035), M["frame"])
    # pull-up bar across the front, knurled steel
    tube("pullup", 0.019, W + 0.16, (0, -D / 2, H - 0.05), M["steel"], axis="X", verts=20)
    # J-hooks holding the barbell at 1.45 m
    BAR_H = 1.45
    for sx in (-1, 1):
        box(f"jcup{sx}", (0.10, 0.13, 0.05), (sx * (W / 2 - 0.02), -D / 2 + 0.10, BAR_H), M["frame"])
        box(f"jlip{sx}", (0.10, 0.03, 0.09), (sx * (W / 2 - 0.02), -D / 2 + 0.17, BAR_H + 0.05), M["frame"])
    # safety arms
    for sx in (-1, 1):
        box(f"safety{sx}", (0.07, D * 0.8, 0.05), (sx * (W / 2 - 0.01), 0, 0.95), M["frame"])
    # numbered hole strip (visual only)
    for i in range(18):
        for sx in (-1, 1):
            tube(f"hole{i}{sx}", 0.012, post + 0.01, (sx * W / 2, -D / 2, 0.55 + i * 0.09), M["plastic"], axis="Y", verts=8)
    export("gym_rack")


def barbell(name="gym_barbell", plates=3):
    """20 kg olympic bar: 2.2 m, 28 mm shaft, 50 mm sleeves, bumper plates."""
    new_collection_clear()
    M = mats()
    tube("shaft", 0.014, 1.31, (0, 0, 0), M["steel"], axis="X", verts=18)
    for sx in (-1, 1):
        tube(f"sleeve{sx}", 0.025, 0.42, (sx * (1.31 / 2 + 0.21), 0, 0), M["steel"], axis="X", verts=18)
        tube(f"collar{sx}", 0.038, 0.035, (sx * (1.31 / 2 + 0.02), 0, 0), M["frame"], axis="X", verts=18)
        for i in range(plates):
            # 450 mm bumper plates, stacked outward from the collar
            tube(f"plate{sx}{i}", 0.225, 0.055, (sx * (1.31 / 2 + 0.075 + i * 0.06), 0, 0), M["rubber"], axis="X", verts=28)
            tube(f"plateHub{sx}{i}", 0.06, 0.058, (sx * (1.31 / 2 + 0.075 + i * 0.06), 0, 0), M["steel"], axis="X", verts=18)
    export(name)


def bench():
    """Flat/incline bench: pad top at 0.45 m, 1.2 m long."""
    new_collection_clear()
    M = mats()
    PAD_H = 0.45
    pad = box("pad", (0.31, 1.22, 0.10), (0, 0, PAD_H), M["pad"])
    bevel(pad, 0.03, 3)
    box("padBack", (0.31, 0.46, 0.09), (0, -0.78, PAD_H + 0.02), M["pad"], rot=(math.radians(-14), 0, 0))
    # frame
    box("spine", (0.09, 1.5, 0.08), (0, 0, PAD_H - 0.10), M["frame"])
    for sy in (-1, 1):
        box(f"leg{sy}", (0.5, 0.08, 0.07), (0, sy * 0.62, 0.035), M["frame"])
        box(f"riser{sy}", (0.07, 0.07, PAD_H - 0.14), (0, sy * 0.62, (PAD_H - 0.14) / 2 + 0.05), M["frame"],
            rot=(math.radians(sy * 9), 0, 0))
    # adjustment ladder
    for i in range(5):
        tube(f"rung{i}", 0.012, 0.16, (0, -0.55 + i * 0.07, 0.30 + i * 0.03), M["steel"], axis="X", verts=10)
    export("gym_bench")


def dumbbell_rack():
    """Two-tier rack, 1.8 m wide, with hex dumbbells in pairs."""
    new_collection_clear()
    M = mats()
    W = 1.8
    for sx in (-1, 1):
        box(f"end{sx}", (0.06, 0.62, 0.86), (sx * W / 2, 0, 0.43), M["frame"], rot=(0, math.radians(sx * -4), 0))
        box(f"foot{sx}", (0.10, 0.72, 0.07), (sx * W / 2, 0, 0.035), M["frame"])
    for tier, (z, y) in enumerate([(0.78, -0.10), (0.46, 0.06)]):
        box(f"shelf{tier}", (W, 0.30, 0.05), (0, y, z), M["frame"])
        # a row of hex dumbbells, getting heavier to the right
        for i in range(6):
            x = -W / 2 + 0.17 + i * 0.29
            r = 0.055 + i * 0.008
            for side in (-1, 1):
                hx = x
                hy = y + side * 0.105
                tube(f"head{tier}{i}{side}", r, 0.10, (hx, hy, z + 0.03 + r), M["rubber"], axis="Y", verts=6)
            tube(f"handle{tier}{i}", 0.017, 0.13, (x, y, z + 0.03 + r), M["steel"], axis="Y", verts=12)
    export("gym_dumbbells")


def cable_machine():
    """Dual cable station: 2.4 m towers, pulleys at 2.1 m, handles at 1.5 m."""
    new_collection_clear()
    M = mats()
    W, H = 1.9, 2.42
    for sx in (-1, 1):
        box(f"tower{sx}", (0.13, 0.28, H), (sx * W / 2, 0, H / 2), M["frame"])
        box(f"base{sx}", (0.42, 0.62, 0.09), (sx * W / 2, 0, 0.045), M["frame"])
        # weight stack
        for i in range(12):
            box(f"weight{sx}{i}", (0.30, 0.20, 0.035), (sx * W / 2, 0, 0.22 + i * 0.045), M["rubber"])
        tube(f"guide{sx}a", 0.008, H - 0.4, (sx * W / 2 - 0.07, 0, H / 2), M["steel"], verts=8)
        tube(f"guide{sx}b", 0.008, H - 0.4, (sx * W / 2 + 0.07, 0, H / 2), M["steel"], verts=8)
        # pulley and cable down to a handle
        tube(f"pulley{sx}", 0.06, 0.03, (sx * (W / 2 - 0.12), -0.16, 2.12), M["steel"], axis="Y", verts=16)
        tube(f"cable{sx}", 0.006, 0.62, (sx * (W / 2 - 0.12), -0.16, 1.81), M["plastic"], verts=8)
        tube(f"handle{sx}", 0.014, 0.16, (sx * (W / 2 - 0.12), -0.16, 1.50), M["grip"], axis="X", verts=12)
    box("crossbar", (W, 0.12, 0.12), (0, 0, H - 0.06), M["frame"])
    export("gym_cable")


def treadmill():
    """Deck at 0.22 m, console at 1.30 m, 2.0 m long."""
    new_collection_clear()
    M = mats()
    box("deck", (0.86, 1.94, 0.12), (0, 0, 0.16), M["frame"])
    # cross feet, or the whole deck floats 100 mm clear of the floor
    for sy in (-1, 1):
        box(f"foot{sy}", (0.92, 0.10, 0.10), (0, sy * 0.86, 0.05), M["plastic"])
    belt = box("belt", (0.56, 1.72, 0.04), (0, 0, 0.235), M["rubber"])
    bevel(belt, 0.01, 2)
    for sx in (-1, 1):
        box(f"rail{sx}", (0.12, 1.9, 0.08), (sx * 0.40, 0, 0.26), M["plastic"])
        # upright and handrail
        box(f"upright{sx}", (0.07, 0.10, 1.05), (sx * 0.38, 0.82, 0.74), M["frame"], rot=(math.radians(-8), 0, 0))
        tube(f"grip{sx}", 0.018, 0.52, (sx * 0.38, 0.62, 1.12), M["grip"], axis="Y", verts=12)
    console = box("console", (0.72, 0.09, 0.42), (0, 0.92, 1.30), M["frame"], rot=(math.radians(-18), 0, 0))
    bevel(console, 0.01, 2)
    box("screen", (0.52, 0.03, 0.26), (0, 0.86, 1.31), M["screen"], rot=(math.radians(-18), 0, 0))
    export("gym_treadmill")


def plate_tree():
    new_collection_clear()
    M = mats()
    box("base", (0.62, 0.62, 0.08), (0, 0, 0.04), M["frame"])
    tube("column", 0.05, 1.15, (0, 0, 0.62), M["frame"], verts=12)
    for i, z in enumerate([0.22, 0.46, 0.70, 0.94]):
        for sy in (-1, 1):
            tube(f"peg{i}{sy}", 0.022, 0.30, (0, sy * 0.15, z), M["steel"], axis="Y", verts=10)
            for k in range(2):
                tube(f"pl{i}{sy}{k}", 0.16 - i * 0.02, 0.05, (0, sy * (0.22 + k * 0.055), z), M["rubber"], axis="Y", verts=22)
    export("gym_plates")


def kettlebells():
    new_collection_clear()
    M = mats()
    for i in range(4):
        x = -0.5 + i * 0.34
        r = 0.09 + i * 0.012
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, 0, r * 0.92), segments=18, ring_count=12)
        bell = bpy.context.active_object
        bell.scale = (1, 1, 0.86)
        bpy.ops.object.transform_apply(scale=True)
        bell.data.materials.append(M["rubber"])
        bpy.ops.mesh.primitive_torus_add(location=(x, 0, r * 1.75), major_radius=r * 0.62, minor_radius=0.018,
                                         major_segments=18, minor_segments=8, rotation=(math.radians(90), 0, 0))
        handle = bpy.context.active_object
        handle.data.materials.append(M["frame"])
    export("gym_kettlebells")


def mats_and_props():
    new_collection_clear()
    M = mats()
    m = box("mat", (0.62, 1.75, 0.035), (0, 0, 0.018), M["rubber"])
    bevel(m, 0.012, 2)
    export("gym_mat")

    new_collection_clear()
    M = mats()
    bottle = tube("bottle", 0.037, 0.24, (0, 0, 0.12), M["plastic"], verts=14)
    tube("cap", 0.021, 0.04, (0, 0, 0.26), M["accent"], verts=12)
    export("gym_bottle")


power_rack()
barbell()
bench()
dumbbell_rack()
cable_machine()
treadmill()
plate_tree()
kettlebells()
mats_and_props()
print("GYM KIT DONE")
