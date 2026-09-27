"""Model an original mid-engine supercar and export it as a GLB.

    blender -b --factory-startup -P tools/supercar.py -- <out_dir>

Built from measurements rather than traced from any manufacturer's car: this
is the supercar *genre* — 4.7 m long, 2.0 m wide, 1.16 m tall, a wedge that
starts almost at the road and rises over the rear axle — not a copy of a
particular model, and it carries no badge.

The body is lofted through a series of cross-sections along the length, which
is what gives it a continuous surface instead of the boxy look you get from
assembling primitives. Origin sits on the road. The car is modelled nose-towards +Y because that is
the natural way to read the station table, then turned through half a circle
before export: Blender's glTF exporter maps Blender +Y to glTF -Z, and the
vehicle controller drives towards +Z. Without the turn the car drives
backwards, headlights pointing at the camera that is following it.
"""
import bmesh
import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0] if argv else "."
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)

LENGTH = 4.70
WIDTH = 2.00
WHEEL_R = 0.35
WHEEL_W = 0.32


def material(name, base, rough, metal, coat=0.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if emission and "Emission Color" in b.inputs:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = 2.5
    return m


MATS = {
    # a deep saturated red with a clearcoat over it, the way car paint behaves
    "paint": material("CarPaint", (0.62, 0.016, 0.02), 0.22, 0.55, coat=1.0),
    "glass": material("CarGlass", (0.02, 0.025, 0.03), 0.06, 0.0, coat=1.0),
    "trim": material("CarTrim", (0.017, 0.017, 0.019), 0.42, 0.65),
    "rubber": material("CarTyre", (0.015, 0.015, 0.017), 0.95, 0.0),
    "rim": material("CarRim", (0.52, 0.53, 0.56), 0.22, 1.0),
    "lamp": material("CarLamp", (0.85, 0.88, 0.95), 0.1, 0.1, emission=(0.8, 0.85, 1.0)),
    "tail": material("CarTail", (0.7, 0.03, 0.03), 0.2, 0.1, emission=(0.9, 0.05, 0.05)),
}

# ------------------------------------------------------------------ body
# Each station is (y along the car, half-width, floor height, roof height).
# Rear is negative y, nose is positive. The roof line drops to the deck behind
# the cabin, which is what makes it read as mid-engined rather than as a coupe.
STATIONS = [
    (-2.35, 0.86, 0.30, 0.74),   # tail
    (-2.05, 0.96, 0.22, 0.92),
    (-1.55, 1.00, 0.18, 1.00),   # rear haunch, widest point
    (-1.05, 0.99, 0.16, 1.10),   # engine deck
    (-0.55, 0.96, 0.15, 1.16),   # roof peak
    (0.05, 0.92, 0.15, 1.12),
    (0.60, 0.88, 0.16, 0.92),    # windscreen base
    (1.15, 0.84, 0.17, 0.72),
    (1.70, 0.76, 0.19, 0.56),
    (2.10, 0.62, 0.22, 0.44),
    (2.35, 0.44, 0.27, 0.38),    # nose
]


def ring(bm, y, half, floor, roof):
    """One cross-section: a rounded slab, wider at the sill than at the roof."""
    pts = []
    steps = 12
    for i in range(steps):
        a = (i / steps) * math.tau
        # an ellipse squashed towards a rounded rectangle
        cx = math.cos(a)
        cy = math.sin(a)
        k = 0.62                                  # squareness
        x = math.copysign(abs(cx) ** k, cx) * half
        h = (roof - floor) / 2
        z = floor + h + math.copysign(abs(cy) ** k, cy) * h
        # tuck the roof in, so the greenhouse is narrower than the sills
        if cy > 0:
            x *= 1.0 - 0.26 * cy
        pts.append(bm.verts.new((x, y, z)))
    return pts


bm = bmesh.new()
rings = [ring(bm, *s) for s in STATIONS]
for a, b in zip(rings, rings[1:]):
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
# cap the ends
bm.faces.new(list(reversed(rings[0])))
bm.faces.new(rings[-1])
# Bridging ring to ring winds the quads inward, which leaves every normal
# pointing into the car. Blender's viewport hides that; a renderer with
# backface culling does not, and the lighting is wrong either way.
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.normal_update()

mesh = bpy.data.meshes.new("Body")
bm.to_mesh(mesh)
bm.free()
body = bpy.data.objects.new("Body", mesh)
bpy.context.collection.objects.link(body)
body.data.materials.append(MATS["paint"])
body.data.materials.append(MATS["glass"])

for mod, kw in (("Bevel", dict(width=0.02, segments=2, limit_method="ANGLE", angle_limit=math.radians(48))),
                ("Subsurf", dict(levels=1, render_levels=1))):
    if mod == "Bevel":
        m = body.modifiers.new("Bevel", "BEVEL")
        for k, v in kw.items():
            setattr(m, k, v)
    else:
        m = body.modifiers.new("Sub", "SUBSURF")
        m.levels = 1
        m.render_levels = 1
bpy.context.view_layer.objects.active = body
for m in list(body.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
for p in body.data.polygons:
    p.use_smooth = True

# Glazing is assigned to the body's own faces rather than modelled as separate
# panes. A flat pane can never follow a curved roof, and every attempt to place
# one leaves it hovering off the paint from some angle. The thresholds are
# measured off the finished mesh, because subdivision pulls the surface in and
# any height written by hand here would miss.
zs = [v.co.z for v in body.data.vertices]
ys = [v.co.y for v in body.data.vertices]
roof, floor = max(zs), min(zs)
glazed = 0
for poly in body.data.polygons:
    c = poly.center
    # the greenhouse: the upper third of the body, between the axles, on any
    # face that is not pointing at the ground
    if (c.z > floor + (roof - floor) * 0.66
            and min(ys) * 0.45 < c.y < max(ys) * 0.55
            and poly.normal.z > -0.3):
        poly.material_index = 1
        glazed += 1
print("GLAZED", glazed, "faces of", len(body.data.polygons))


def add(name, verts_faces, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts_faces[0], [], verts_faces[1])
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


# ------------------------------------------------------------------ wheels
def wheel(sx, sy):
    x = sx * (WIDTH / 2 - WHEEL_W / 2 - 0.06)
    y = sy * 1.48
    bpy.ops.mesh.primitive_cylinder_add(radius=WHEEL_R, depth=WHEEL_W, vertices=26,
                                        location=(x, y, WHEEL_R),
                                        rotation=(0, math.radians(90), 0))
    t = bpy.context.active_object
    t.name = f"Tyre{sx}{sy}"
    t.data.materials.append(MATS["rubber"])
    for p in t.data.polygons:
        p.use_smooth = True
    bpy.ops.mesh.primitive_cylinder_add(radius=WHEEL_R * 0.64, depth=WHEEL_W * 0.9, vertices=22,
                                        location=(x, y, WHEEL_R),
                                        rotation=(0, math.radians(90), 0))
    r = bpy.context.active_object
    r.name = f"Rim{sx}{sy}"
    r.data.materials.append(MATS["rim"])
    for p in r.data.polygons:
        p.use_smooth = True


for sx in (-1, 1):
    for sy in (-1, 1):
        wheel(sx, sy)

# ------------------------------------------------------------------ details
# Everything below is sunk into the paint rather than stuck onto it: a detail
# that floats clear of the surface reads as a mistake from any angle.
for sx in (-1, 1):
    # the nose is only 0.44 half-width at its tip, so the lamps ride inboard
    box(f"Head{sx}", (0.26, 0.10, 0.07), (sx * 0.38, 2.06, 0.47), MATS["lamp"],
        rot=(math.radians(14), 0, 0))
    box(f"Tail{sx}", (0.26, 0.08, 0.07), (sx * 0.52, -2.28, 0.66), MATS["tail"])
    # side intakes ahead of the rear wheels, the signature of a mid-engined car
    box(f"Intake{sx}", (0.05, 0.50, 0.16), (sx * 0.92, -0.72, 0.60), MATS["trim"])

box("Splitter", (1.44, 0.30, 0.04), (0, 2.08, 0.15), MATS["trim"])
box("Diffuser", (1.40, 0.36, 0.12), (0, -2.16, 0.22), MATS["trim"], rot=(math.radians(-12), 0, 0))

# ------------------------------------------------------------------ export
bpy.ops.object.select_all(action="SELECT")
# turn the whole car to face the other way, so the nose lands on glTF +Z
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.transform.rotate(value=math.pi, orient_axis="Z", center_override=(0, 0, 0))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
path = os.path.join(OUT, "supercar.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True)

tris = sum(len(o.data.loop_triangles) for o in bpy.context.scene.objects
           if o.type == "MESH" and (o.data.calc_loop_triangles() or True))
print("WROTE", path, "tris", tris)
