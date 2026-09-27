"""The cabin, and the markers the game uses to seat and pose the driver.

Left-hand drive (the driver sits at +X). Markers, exported as glTF nodes:
  Seat_Driver      the driver's hip point, on the cushion
  SteeringWheel    the wheel itself, origin at the hub; it turns about its
                   own Z axis in Blender, which is local +Y after export
    Grip_L/Grip_R  nine and three o'clock, riding with the wheel
  Pedals           where the right foot rests
  Door_Driver      where the driver stands after getting out
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Matrix, Vector
from common import apply_modifiers, mesh_obj, rounded_box, w

DRIVER_X = 0.37
H_POINT = (-0.30, 0.335)          # (s, z) of the hip point on the cushion
WHEEL_HUB = (0.26, 0.80)          # (s, z)
WHEEL_R = 0.185


def box(name, size, center, mat, col, radius=0.02, rot=(0, 0, 0)):
    o = rounded_box(name, size, center, col, radius=radius, segments=3, rot=rot)
    o.data.materials.append(mat)
    return o


def seat(name, x, pal, col, rear=False):
    made = []
    s, z = (H_POINT[0], H_POINT[1]) if not rear else (-0.98, 0.33)
    sc = 0.88 if rear else 1.0
    # cushion, nose tipped up, with raised side bolsters
    made.append(box(f"{name}_Cushion", (0.34 * sc, 0.46 * sc, 0.08), w(s + 0.05, x, z - 0.04), pal["alcantara"],
                    col, 0.03, (math.radians(-8), 0, 0)))
    for sx in (1, -1):
        made.append(box(f"{name}_Bolster{sx}", (0.08, 0.46 * sc, 0.11), w(s + 0.05, x + sx * 0.2 * sc, z - 0.02),
                        pal["leather"], col, 0.035, (math.radians(-8), 0, sx * math.radians(4))))
    # backrest, reclined, bolstered, with the headrest built in
    rake = math.radians(-22 if not rear else -14)
    back_c = w(s - 0.24, x, z + 0.3 * sc)
    made.append(box(f"{name}_Back", (0.34 * sc, 0.09, 0.62 * sc), back_c, pal["alcantara"], col, 0.03,
                    (rake, 0, 0)))
    for sx in (1, -1):
        made.append(box(f"{name}_BackBolster{sx}", (0.09, 0.13, 0.52 * sc), back_c + Vector((sx * 0.2 * sc, 0.01, -0.04)),
                        pal["leather"], col, 0.04, (rake, 0, -sx * math.radians(8))))
    if not rear:
        made.append(box(f"{name}_Head", (0.26, 0.1, 0.18), w(s - 0.42, x, z + 0.72), pal["leather"], col, 0.04,
                        (rake, 0, 0)))
        # the mint stitching down the centre panel
        for sx in (1, -1):
            made.append(box(f"{name}_Stitch{sx}", (0.004, 0.012, 0.5), back_c + Vector((sx * 0.13, -0.05, 0)),
                            pal["stitch"], col, 0.0, (rake, 0, 0)))
    return made


def steering_wheel(pal, col):
    s, z = WHEEL_HUB
    hub = w(s, DRIVER_X, z)
    bm = bmesh.new()
    # the rim, flattened at the bottom like a sports wheel
    ring = 48
    major, minor = WHEEL_R, 0.019
    rings = []
    for i in range(ring):
        a = i / ring * 2 * math.pi
        r = major
        y = math.sin(a) * r
        if y < -major * 0.8:
            y = -major * 0.8
        c = Vector((math.cos(a) * r, y, 0))
        tangent = Vector((-math.sin(a), math.cos(a), 0)).normalized()
        outward = Vector((c.x, c.y, 0)).normalized()
        ringv = []
        for j in range(10):
            q = j / 10 * 2 * math.pi
            ringv.append(bm.verts.new(c + outward * math.cos(q) * minor + Vector((0, 0, math.sin(q) * minor * 1.25))))
        rings.append(ringv)
    for i in range(ring):
        a, b = rings[i], rings[(i + 1) % ring]
        for j in range(10):
            k = (j + 1) % 10
            bm.faces.new((a[j], a[k], b[k], b[j]))
    o = mesh_obj("SteeringWheel", bm, col, pal["alcantara"])
    parts = [o]
    # spokes and the hub
    for ang in (0, math.pi, -math.pi / 2):
        sp = rounded_box("spoke", (0.15, 0.03, 0.02), Vector((math.cos(ang) * 0.09, math.sin(ang) * 0.09, 0)),
                         col, radius=0.008, rot=(0, 0, ang))
        sp.data.materials.append(pal["carbon"])
        parts.append(sp)
    hubm = rounded_box("hub", (0.09, 0.08, 0.04), Vector((0, 0, 0.01)), col, radius=0.015)
    hubm.data.materials.append(pal["leather"])
    parts.append(hubm)
    badge = rounded_box("badge", (0.03, 0.03, 0.004), Vector((0, 0, 0.032)), col, radius=0.012)
    badge.data.materials.append(pal["mint"])
    parts.append(badge)
    # a mint centre marker at twelve o'clock, like a race wheel
    top = rounded_box("marker", (0.016, 0.01, 0.042), Vector((0, WHEEL_R, 0)), col, radius=0.004)
    top.data.materials.append(pal["mint"])
    parts.append(top)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()
    for p in o.data.polygons:
        p.use_smooth = True
    # tilt the wheel so its face looks up the column at the driver's chest
    face = Vector((0, 0.94, 0.34)).normalized()      # rearward (+Y) and up
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(face)
    o.location = hub
    for tag, sx in (("Grip_L", -1), ("Grip_R", 1)):
        g = bpy.data.objects.new(tag, None)
        col.objects.link(g)
        g.parent = o
        g.location = (sx * WHEEL_R, 0, 0)
    # the column, into the dash
    col_len = 0.3
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.035, radius2=0.03, depth=col_len)
    colm = mesh_obj("SteeringColumn", bm, col, pal["plastic"])
    colm.rotation_mode = "QUATERNION"
    colm.rotation_quaternion = o.rotation_quaternion
    colm.location = hub - face * (col_len / 2 + 0.02)
    return [o, colm]


def dashboard(pal, col):
    made = []
    # the dash: a lofted slab that wraps from door to door
    bm = bmesh.new()
    rows = []
    for x in np.linspace(-0.86, 0.86, 25):
        prof = [(0.74, 0.55), (0.72, 0.74), (0.62, 0.84), (0.48, 0.86), (0.4, 0.8), (0.38, 0.66), (0.44, 0.55)]
        # a binnacle hood over the driver's instruments
        bump = 0.035 * math.exp(-((x - DRIVER_X) / 0.16) ** 2)
        rows.append([bm.verts.new(w(s, x, z + (bump if 0.4 < s < 0.66 and z > 0.8 else 0))) for s, z in prof])
    n = len(rows[0])
    for a, b in zip(rows, rows[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    dash = mesh_obj("Dashboard", bm, col, pal["leather"])
    sub = dash.modifiers.new("s", "SUBSURF")
    sub.levels = 2
    apply_modifiers(dash)
    made.append(dash)
    # screens: the driver's cluster and the centre display
    made.append(box("Cluster", (0.3, 0.012, 0.1), w(0.47, DRIVER_X, 0.83), pal["screen"], col, 0.01,
                    (math.radians(-68), 0, 0)))
    made.append(box("CentreScreen", (0.26, 0.012, 0.15), w(0.43, 0.0, 0.76), pal["screen"], col, 0.01,
                    (math.radians(-72), 0, 0)))
    # vents
    for x in (-0.62, -0.18, 0.18, 0.62):
        made.append(box(f"Vent_{x}", (0.1, 0.03, 0.04), w(0.39, x, 0.7), pal["chrome"], col, 0.01))
    return made


def console(pal, col):
    made = [box("Console", (0.22, 0.95, 0.24), w(-0.05, 0, 0.33), pal["leather"], col, 0.04)]
    made.append(box("ConsoleTop", (0.2, 0.9, 0.02), w(-0.05, 0, 0.455), pal["carbon"], col, 0.008))
    made.append(box("Selector", (0.05, 0.08, 0.06), w(0.12, 0, 0.49), pal["chrome"], col, 0.02))
    made.append(box("Armrest", (0.2, 0.3, 0.05), w(-0.45, 0, 0.5), pal["alcantara"], col, 0.025))
    return made


def trim(pal, col):
    made = [box("Carpet", (1.72, 1.9, 0.02), w(-0.15, 0, 0.2), pal["alcantara"], col, 0.01)]
    for sx in (1, -1):
        made.append(box(f"DoorCard_{sx}", (0.04, 1.2, 0.5), w(-0.05, sx * 0.84, 0.55), pal["leather"], col, 0.02))
        made.append(box(f"DoorArm_{sx}", (0.08, 0.4, 0.05), w(-0.1, sx * 0.8, 0.6), pal["alcantara"], col, 0.02))
        made.append(box(f"DoorStrip_{sx}", (0.01, 1.0, 0.008), w(-0.05, sx * 0.815, 0.72), pal["mint"], col, 0.0))
    made.append(box("RearMirror", (0.2, 0.02, 0.06), w(0.06, 0, 1.16), pal["plastic"], col, 0.02))
    for x, h in ((DRIVER_X - 0.07, 0.06), (DRIVER_X + 0.06, 0.1)):
        made.append(box(f"Pedal_{x}", (0.06, 0.02, h), w(0.66, x, 0.27), pal["chrome"], col, 0.005,
                        (math.radians(30), 0, 0)))
    return made


def markers(col):
    made = {}
    for name, loc in (("Seat_Driver", w(H_POINT[0], DRIVER_X, H_POINT[1])),
                      ("Pedals", w(0.64, DRIVER_X + 0.03, 0.26)),
                      ("Door_Driver", w(-0.1, 1.6, 0.0))):
        e = bpy.data.objects.new(name, None)
        col.objects.link(e)
        e.location = loc
        made[name] = e
    return made


def build(col, pal, ctx):
    made = []
    made += seat("SeatDriver", DRIVER_X, pal, col)
    made += seat("SeatPassenger", -DRIVER_X, pal, col)
    made += seat("SeatRearL", 0.33, pal, col, rear=True)
    made += seat("SeatRearR", -0.33, pal, col, rear=True)
    made += steering_wheel(pal, col)
    made += dashboard(pal, col)
    made += console(pal, col)
    made += trim(pal, col)
    m = markers(col)
    print("INTERIOR", len(made), list(m))
    return {"objects": made, "markers": m}
