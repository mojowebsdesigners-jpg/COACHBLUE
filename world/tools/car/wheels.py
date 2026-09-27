"""Wheels: a lathed low-profile tyre with real tread, a 19" ten-spoke rim,
a brake disc and a calliper, at each corner.

Each corner is a small hierarchy the game drives:
  Wheel_FL          empty at the hub: steers (rotates about Y in glTF)
    Wheel_FL_Spin   tyre, rim, disc: spins about the axle (local X)
    Caliper_FL      stays put, the way a real calliper does
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Matrix, Vector
from common import FRONT_AXLE, REAR_AXLE, TRACK, TYRE_R, TYRE_W, apply_modifiers, mesh_obj, w

SEG = 180


def lathe(bm, profile, steps=SEG, sipes=False):
    """Revolve (axial x, radius r) points about the X axis."""
    rings = []
    for k in range(steps):
        a = k / steps * 2 * math.pi
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for x, r in profile:
            rr = r
            if sipes and abs(x) > 0.035 and r > TYRE_R - 0.004:
                # lateral sipes across the shoulder blocks, staggered side to side
                phase = (a * 34 / (2 * math.pi) + (0.5 if x > 0 else 0)) % 1.0
                if phase < 0.16:
                    rr -= 0.005
            ring.append(bm.verts.new((x, rr * ca, rr * sa)))
        rings.append(ring)
    n = len(profile)
    for k in range(steps):
        a, b = rings[k], rings[(k + 1) % steps]
        for i in range(n - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    # outward from the axle
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((0, c.y, c.z))) < 0:
            f.normal_flip()


def tyre_profile():
    R, H = TYRE_R, TYRE_W / 2
    side = [(-H + 0.013, 0.243), (-H + 0.002, 0.27), (-H - 0.002, 0.3), (-H + 0.004, 0.325),
            (-H + 0.016, 0.339), (-H + 0.035, R)]
    tread = []
    for gx in (-0.066, -0.012, 0.042):       # three circumferential grooves
        tread += [(gx - 0.012, R), (gx - 0.008, R - 0.009), (gx + 0.002, R - 0.009), (gx + 0.006, R)]
    right = [(-x, r) for x, r in side[::-1]]
    return side + tread + right


def rim_profile():
    return [(-0.128, 0.246), (-0.122, 0.238), (-0.1, 0.232), (0.09, 0.232), (0.112, 0.236),
            (0.124, 0.244), (0.131, 0.252), (0.127, 0.258), (0.117, 0.252)]


def spoke(bm, angle, twist):
    """One spoke: a tapered bar from hub to rim, dished toward the outer face."""
    secs = []
    for t in np.linspace(0, 1, 6):
        r = 0.085 + t * 0.152
        width = 0.042 - t * 0.014
        depth = 0.05 - t * 0.022
        x = 0.07 + 0.045 * t ** 1.6              # the dish: spokes rise to the lip
        a = angle + twist * t
        ca, sa = math.cos(a), math.sin(a)
        tang = Vector((0, -sa, ca))
        rad = Vector((0, ca, sa))
        c = Vector((x, 0, 0)) + rad * r
        secs.append([bm.verts.new(c + tang * width / 2 * u + Vector((depth / 2 * v, 0, 0)))
                     for u, v in ((-1, 1), (1, 1), (1, -1), (-1, -1))])
    for a, b in zip(secs, secs[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(secs[0][::-1])
    bm.faces.new(secs[-1])


def cylinder(bm, x0, x1, r, segs=48):
    bot = [bm.verts.new((x0, r * math.cos(a), r * math.sin(a))) for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)]
    top = [bm.verts.new((x1, r * math.cos(a), r * math.sin(a))) for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)]
    bm.faces.new(bot[::-1])
    bm.faces.new(top)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((bot[i], bot[j], top[j], top[i]))


def wheel_prototype(col, pal):
    parts = []
    bm = bmesh.new()
    lathe(bm, tyre_profile(), sipes=True)
    parts.append(("tyre", mesh_obj("proto_tyre", bm, col, pal["rubber"])))
    bm = bmesh.new()
    lathe(bm, rim_profile(), steps=96)
    parts.append(("rim", mesh_obj("proto_rim", bm, col, pal["rim_lip"])))
    bm = bmesh.new()
    for k in range(5):
        base = k * 2 * math.pi / 5
        for off in (-0.13, 0.13):              # five pairs: a split-spoke design
            spoke(bm, base + off, off * 0.35)
    cylinder(bm, 0.05, 0.095, 0.092, 48)      # hub face
    parts.append(("spokes", mesh_obj("proto_spokes", bm, col, pal["rim"])))
    bm = bmesh.new()
    for k in range(5):
        a = k * 2 * math.pi / 5 + math.pi / 5
        c = Vector((0, 0.052 * math.cos(a), 0.052 * math.sin(a)))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.011, radius2=0.011, depth=0.03,
                              matrix=Matrix.Translation(c + Vector((0.105, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    parts.append(("lugs", mesh_obj("proto_lugs", bm, col, pal["chrome"])))
    bm = bmesh.new()
    cylinder(bm, 0.1, 0.112, 0.034, 32)
    parts.append(("cap", mesh_obj("proto_cap", bm, col, pal["mint"])))
    bm = bmesh.new()
    cylinder(bm, -0.035, -0.003, 0.19, 64)    # disc
    cylinder(bm, -0.003, 0.05, 0.085, 32)     # hat
    parts.append(("disc", mesh_obj("proto_disc", bm, col, pal["disc"])))
    for _, o in parts:
        for p in o.data.polygons:
            p.use_smooth = True
    # join the spinning parts into one mesh
    bpy.ops.object.select_all(action="DESELECT")
    for _, o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0][1]
    bpy.ops.object.join()
    spin = bpy.context.active_object
    spin.name = "proto_spin"
    # calliper: an arc block over the disc, toward the back of the wheel
    bm = bmesh.new()
    # behind the axle (the car's rear is +Y), just above hub height
    a0, a1 = math.radians(22), math.radians(78)
    rings = []
    for a in np.linspace(a0, a1, 10):
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((x, r * ca, r * sa)) for x, r in
                      ((-0.06, 0.13), (-0.06, 0.212), (0.012, 0.212), (0.012, 0.13))])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cal = mesh_obj("proto_caliper", bm, col, pal["caliper"])
    bev = cal.modifiers.new("b", "BEVEL")
    bev.width, bev.segments = 0.006, 2
    apply_modifiers(cal)
    return spin, cal


def place(proto, name, loc, mirror, col):
    o = proto.copy()
    o.data = proto.data.copy()
    o.name = name
    col.objects.link(o)
    if mirror:
        # the prototype's outer face looks down +X; the right-hand wheels are
        # its mirror image, with normals turned back outward
        o.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
        o.data.flip_normals()
    return o


def build(col, pal, ctx):
    spin, cal = wheel_prototype(col, pal)
    made = {}
    for tag, s_ax in (("F", FRONT_AXLE), ("R", REAR_AXLE)):
        for side, sx in (("L", 1), ("R", -1)):
            name = f"Wheel_{tag}{side}"
            hub = bpy.data.objects.new(name, None)
            col.objects.link(hub)
            hub.location = w(s_ax, sx * TRACK / 2, TYRE_R)
            sp = place(spin, f"{name}_Spin", None, sx < 0, col)
            cp = place(cal, f"Caliper_{tag}{side}", None, sx < 0, col)
            if tag == "R":
                # rear callipers sit ahead of the axle, fronts behind it
                cp.data.transform(Matrix.Rotation(math.radians(80), 4, "X"))
            for child in (sp, cp):
                child.parent = hub
            made[name] = hub
    bpy.data.objects.remove(spin, do_unlink=True)
    bpy.data.objects.remove(cal, do_unlink=True)
    print("WHEELS", list(made))
    return made
