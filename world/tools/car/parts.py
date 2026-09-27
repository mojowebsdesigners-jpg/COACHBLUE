"""Exterior parts: lamps, intakes, aero, mirrors, handles, plates, lettering.

Lamps are cut into the body the way real ones sit: a recess is bored out of
the panel, and the lens is the *same surface* cut out with the same cutter
(from the unthickened skin), so every lens is flush with the paint and keeps
its curvature. Behind it: a chrome reflector bowl, the emitters, and a dark
housing so the recess never shows the inside of the body.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Matrix, Vector
from common import (ARCH_R, FRONT_AXLE, REAR_AXLE, TRACK, TYRE_R, apply_modifiers, boolean,
                    collection, link, mesh_obj, rounded_box, w)
from body import hw, zb, zdeck, zsh


def duplicate(obj, name):
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    for c in obj.users_collection:
        c.objects.link(o)
    return o


def surface_frame(skin, point):
    """Closest point on the body skin and its outward normal."""
    inv = skin.matrix_world.inverted()
    ok, loc, nrm, _ = skin.closest_point_on_mesh(inv @ point)
    mw = skin.matrix_world
    n = (mw.to_3x3() @ nrm).normalized()
    # the skin's normals can face either way on an open surface; outward is
    # away from the car's centre line
    if n.dot(Vector((point.x, 0, point.z - 0.5)).normalized()) < 0 and abs(point.x) > 0.3:
        n = -n
    return mw @ loc, n


def outline_teardrop(width, height, taper=0.45, n=28):
    """A swept lamp outline in (u, v): full height inboard, tapering outboard."""
    pts = []
    for k in range(n):
        a = k / n * 2 * math.pi
        u = math.cos(a) * width / 2
        t = (u / (width / 2) + 1) / 2            # 0 inboard .. 1 outboard
        v = math.sin(a) * height / 2 * (1 - taper * t ** 1.5)
        # superellipse corners: sharper than an ellipse, softer than a box
        k2 = 0.55
        u = math.copysign(abs(math.cos(a)) ** k2, math.cos(a)) * width / 2
        v = math.copysign(abs(math.sin(a)) ** k2, math.sin(a)) * height / 2 * (1 - taper * t ** 1.5)
        pts.append((u, v))
    return pts


def outline_rect(width, height, r=0.3, n=32):
    pts = []
    for k in range(n):
        a = k / n * 2 * math.pi
        u = math.copysign(abs(math.cos(a)) ** r, math.cos(a)) * width / 2
        v = math.copysign(abs(math.sin(a)) ** r, math.sin(a)) * height / 2
        pts.append((u, v))
    return pts


def lamp_patch(name, skin, frame, outline, offset, col, mat):
    """The outline filled, finely divided and shrink-wrapped onto the skin."""
    c, t, b, n = frame
    bm = bmesh.new()
    vs = [bm.verts.new(c + t * u + b * v + n * 0.05) for u, v in outline]
    f = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="BEAUTY")
    for _ in range(3):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    o = mesh_obj(name, bm, col, mat)
    sw = o.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = skin
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.offset = offset
    apply_modifiers(o)
    return o


def inset_lamp(body, skin, hint, sweep, outline, depth, lens_mat, bowl_mat, col, name):
    """A lamp set flush into the body: clear lens, reflector bowl, clean hole."""
    c, n = surface_frame(skin, hint)
    t = (Vector(sweep) - n * Vector(sweep).dot(n)).normalized()
    b = n.cross(t).normalized()
    frame = (c, t, b, n)
    lens = lamp_patch(name + "_Lens", skin, frame, outline, 0.0018, col, lens_mat)
    bowl = lamp_patch(name + "_Housing", skin, frame, [(u * 0.97, v * 0.9) for u, v in outline], -depth,
                      col, bowl_mat)
    # walls from the lens rim down to the bowl rim, so the recess is closed
    bm = bmesh.new()
    rim = [c + t * u + b * v for u, v in outline]
    lo = [c + t * u * 0.97 + b * v * 0.9 for u, v in outline]
    inv = skin.matrix_world.inverted()
    top, bot = [], []
    for p_hi, p_lo in zip(rim, lo):
        ok, loc, nrm, _ = skin.closest_point_on_mesh(inv @ p_hi)
        top.append(bm.verts.new(skin.matrix_world @ loc))
        ok, loc, nrm, _ = skin.closest_point_on_mesh(inv @ p_lo)
        bot.append(bm.verts.new(skin.matrix_world @ loc - n * depth))
    m = len(top)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    walls = mesh_obj(name + "_Walls", bm, col, bowl_mat)
    walls.data.materials[0].use_backface_culling = False
    # the hole: a straight prism of the outline, through the panel
    bm = bmesh.new()
    front = [bm.verts.new(c + t * u * 1.005 + b * v * 1.005 + n * 0.08) for u, v in outline]
    back = [bm.verts.new(c + t * u * 1.005 + b * v * 1.005 - n * 0.08) for u, v in outline]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cutter = mesh_obj("lampcut", bm, col, smooth=False)
    boolean(body, cutter)
    return [lens, bowl, walls], frame


def emitter_strip(name, pts, radius, mat, col):
    """A glowing tube along a polyline: DRL and tail light bars."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1.0)
    o = bpy.data.objects.new(name, cu)
    col.objects.link(o)
    o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    return bpy.context.active_object


def disc(name, center, normal, radius, depth, mat, col, segments=32):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius,
                          depth=depth)
    o = mesh_obj(name, bm, col, mat)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(normal))
    o.location = center
    return o


def headlights(body, skin, pal, col):
    made = []
    for sx in (1, -1):
        side = "L" if sx > 0 else "R"
        hint = w(2.0, sx * 0.64, 0.68)
        # swept back and outward along the top of the fender
        sweep = w(-0.35, sx * 1.0, 0.1) - w(0, 0, 0)
        outline = [(u * sx, v) for u, v in outline_teardrop(0.42, 0.13, taper=0.5)]
        parts_, (c, t, b, n) = inset_lamp(body, skin, hint, sweep, outline, 0.045, pal["lens"],
                                          pal["reflector"], col, f"Headlight_{side}")
        made += parts_
        # two projector lenses and their LED cores, set down in the bowl
        for k, u in enumerate((-0.09, 0.03)):
            p = c + t * u * sx - n * 0.03
            made.append(disc(f"Projector_{side}{k}", p, n, 0.036, 0.02, pal["trim"], col))
            made.append(disc(f"LED_{side}{k}", p + n * 0.011, n, 0.022, 0.004, pal["led"], col))
        # the daytime running light: a blade along the lamp's upper edge
        pts = [tuple(c + t * (u * sx) + b * (0.042 - 0.03 * max(0, u + 0.05) ** 1.2) - n * 0.012)
               for u in np.linspace(-0.19, 0.17, 12)]
        made.append(emitter_strip(f"DRL_{side}", pts, 0.005, pal["drl"], col))
    return made


def taillights(body, skin, pal, col):
    made = []
    # a full-width bar across the tail, with the lamps proper at each corner
    parts_, (c, t, b, n) = inset_lamp(body, skin, w(-2.205, 0, 0.855), w(0, -1, 0) - w(0, 0, 0),
                                      outline_rect(1.3, 0.045, 0.2), 0.02, pal["tail_lens"], pal["trim"],
                                      col, "Taillight_Bar")
    made += parts_
    pts = [tuple(c + t * u - n * 0.008) for u in np.linspace(-0.62, 0.62, 20)]
    made.append(emitter_strip("TailBar", pts, 0.008, pal["tail"], col))
    for sx in (1, -1):
        side = "L" if sx > 0 else "R"
        hint = w(-2.12, sx * 0.72, 0.85)
        sweep = w(0.3, sx * 1.0, 0) - w(0, 0, 0)
        outline = [(u * sx, v) for u, v in outline_teardrop(0.3, 0.085, taper=0.35)]
        parts_, (c, t, b, n) = inset_lamp(body, skin, hint, sweep, outline, 0.03, pal["tail_lens"],
                                          pal["trim"], col, f"Taillight_{side}")
        made += parts_
        pts = [tuple(c + t * (u * sx) + b * 0.018 - n * 0.012) for u in np.linspace(-0.13, 0.12, 8)]
        made.append(emitter_strip(f"Tail_{side}", pts, 0.007, pal["tail"], col))
        pts = [tuple(c + t * (u * sx) - b * 0.02 - n * 0.014) for u in np.linspace(-0.1, 0.08, 6)]
        made.append(emitter_strip(f"Indicator_{side}", pts, 0.005, pal["indicator"], col))
    return made


def honeycomb(name, center, width, height, cell, mat, col):
    bm = bmesh.new()
    rows = int(height / (cell * 0.87)) + 1
    cols = int(width / cell) + 1
    for r in range(rows):
        for q in range(cols):
            cx = -width / 2 + q * cell + (cell / 2 if r % 2 else 0)
            cz = -height / 2 + r * cell * 0.87
            ring = []
            for k in range(6):
                a = math.pi / 6 + k * math.pi / 3
                ring.append((cx + math.cos(a) * cell * 0.46, cz + math.sin(a) * cell * 0.46))
            outer = [bm.verts.new((px, 0, pz)) for px, pz in ring]
            inner = [bm.verts.new((cx + (px - cx) * 0.72, 0, cz + (pz - cz) * 0.72)) for px, pz in ring]
            for k in range(6):
                j = (k + 1) % 6
                bm.faces.new((outer[k], outer[j], inner[j], inner[k]))
    o = mesh_obj(name, bm, col, mat)
    sol = o.modifiers.new("t", "SOLIDIFY")
    sol.thickness = 0.02
    apply_modifiers(o)
    o.location = center
    return o


def intakes(body, pal, col):
    made = []
    # the main lower intake
    boolean(body, rounded_box("intake", (1.02, 0.4, 0.15), w(2.22, 0, 0.335), col, radius=0.05))
    made.append(honeycomb("Grille", w(2.12, 0, 0.335), 1.0, 0.15, 0.03, pal["plastic"], col))
    made.append(rounded_box("GrilleBack", (1.04, 0.02, 0.17), w(2.08, 0, 0.335), col, radius=0.0))
    made[-1].data.materials.append(pal["interior"])
    # corner intakes beside it
    for sx in (1, -1):
        boolean(body, rounded_box("side_intake", (0.2, 0.4, 0.12), w(2.12, sx * 0.72, 0.32), col,
                                  radius=0.04, rot=(0, 0, sx * math.radians(30))))
        g = honeycomb(f"SideGrille_{sx}", w(2.02, sx * 0.72, 0.32), 0.2, 0.12, 0.028, pal["plastic"], col)
        g.rotation_euler = (0, 0, sx * math.radians(30))
        made.append(g)
    return made


def loft_strip(name, stations, profile, mat, col):
    """Extrude a 2D profile (x, z offsets) along a list of (s, x, z) points."""
    bm = bmesh.new()
    rings = []
    for s, x, z in stations:
        rings.append([bm.verts.new(w(s, x + px, z + pz)) for px, pz in profile])
    n = len(profile)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_obj(name, bm, col, mat)
    bev = o.modifiers.new("b", "BEVEL")
    bev.width = 0.006
    bev.segments = 2
    apply_modifiers(o)
    return o


def aero(pal, col):
    made = []
    # side skirts in carbon, following the sill between the arches
    for sx in (1, -1):
        sts = [(s, sx * (float(hw(s)) - 0.035), float(zb(s)) + 0.03) for s in np.linspace(-0.93, 0.95, 16)]
        prof = [(0, -0.02), (sx * 0.045, -0.03), (sx * 0.055, 0.02), (0, 0.045)]
        made.append(loft_strip(f"Skirt_{sx}", sts, prof, pal["carbon"], col))
    # front splitter
    sts = [(s, 0, 0.19) for s in (1.92, 2.3)]
    bm = bmesh.new()
    outline = []
    for t in np.linspace(-1, 1, 25):
        s = 2.3 - 0.12 * abs(t) ** 3
        outline.append((s, t * (float(hw(s - 0.08)) - 0.03)))
    top = [bm.verts.new(w(s, x, 0.2)) for s, x in outline] + \
          [bm.verts.new(w(1.96, x, 0.2)) for s, x in outline[::-1]]
    f = bm.faces.new(top)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z -= 0.022
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(mesh_obj("Splitter", bm, col, pal["carbon"]))
    # The rear: a carbon lower bumper closes the gap under the tail and the
    # exhausts leave through its face — nothing hangs in free air below it.
    made.append(rounded_box("Valance", (1.40, 0.34, 0.2), w(-2.1, 0, 0.43), col, radius=0.03))
    made[-1].data.materials.append(pal["carbon"])
    # the diffuser is the valance's dark underside: a separate tray under the
    # tail read as something hanging off the car from every chase-cam angle
    for sx in (1, -1):
        for x in (0.42, 0.56):
            made.append(disc(f"Exhaust_{sx}_{x}", w(-2.2, sx * x, 0.4), (0, 1, 0), 0.042, 0.08, pal["exhaust"], col, 40))
            made.append(disc(f"ExhaustIn_{sx}_{x}", w(-2.285, sx * x, 0.4), (0, 1, 0), 0.034, 0.005,
                             pal["interior"], col, 40))
    return made


def liners(pal, col):
    made = []
    for s_ax in (FRONT_AXLE, REAR_AXLE):
        for sx in (1, -1):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=ARCH_R + 0.012,
                                  radius2=ARCH_R + 0.012, depth=0.3)
            o = mesh_obj(f"Liner_{s_ax:+.1f}_{sx}", bm, col, pal["plastic"])
            o.rotation_euler = (0, math.pi / 2, 0)
            o.location = w(s_ax, sx * (TRACK / 2 - 0.12), TYRE_R + 0.01)
            bpy.context.view_layer.update()
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            # nothing below the sill line, or the liner shows under the car
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < 0.2],
                             context="FACES")
            bm.to_mesh(o.data)
            bm.free()
            made.append(o)
    return made


def mirrors(pal, col):
    made = []
    for sx in (1, -1):
        base = w(0.5, sx * (float(hw(0.5)) - 0.12), float(zsh(0.5)) + 0.035)
        stalk = rounded_box(f"MirrorStalk_{sx}", (0.1, 0.05, 0.03), base + Vector((sx * 0.06, 0, 0.02)),
                            col, radius=0.01, rot=(0, 0, 0))
        stalk.data.materials.append(pal["carbon"])
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.5)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.2, v.co.y * (0.14 if v.co.y < 0 else 0.07), v.co.z * 0.11))
        head = mesh_obj(f"Mirror_{sx}", bm, col, pal["paint"])
        head.location = base + Vector((sx * 0.14, 0.02, 0.05))
        head.rotation_euler = (0, 0, -sx * math.radians(8))
        made += [stalk, head]
        glass = disc(f"MirrorGlass_{sx}", base + Vector((sx * 0.14, 0.058, 0.05)), (0, 1, 0), 0.075, 0.003,
                     pal["chrome"], col, 32)
        glass.scale = (1.25, 1, 0.72)
        made.append(glass)
    return made


def handles(pal, col):
    made = []
    for sx in (1, -1):
        s = -0.52
        x = sx * (float(hw(s)) - 0.018)
        h = rounded_box(f"Handle_{sx}", (0.012, 0.16, 0.022), w(s, x, float(zsh(s)) - 0.07), col, radius=0.006)
        h.data.materials.append(pal["chrome"])
        made.append(h)
    return made


def text_mesh(name, body, size, center, rot, mat, col, depth=0.002, align="CENTER"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth
    cu.align_x = align
    cu.align_y = "CENTER"
    o = bpy.data.objects.new(name, cu)
    col.objects.link(o)
    o.data.materials.append(mat)
    o.location = center
    o.rotation_euler = rot
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    return bpy.context.active_object


def tail_surface(body, z, x=0.0):
    """Where the tail's skin is at height z: cast in from behind the car."""
    ok, loc, nrm, _ = body.ray_cast(w(-3.0, x, z), Vector((0, -1, 0)))
    return -loc.y if ok else -2.22


def plates_and_badges(pal, col, body):
    made = []
    # the rear plate sits on the tail's actual surface, not a guess at it:
    # the tail bulges past its last section once subdivided, and a plate
    # placed by guess vanishes inside it
    rear = tail_surface(body, 0.62) - 0.008
    # text reads the right way round from where it is seen: nose plate faces
    # forward (-Y), tail plate faces back (+Y)
    for s, facing, z in ((2.265, 0.0, 0.47), (rear, math.pi, 0.62)):
        plate = rounded_box(f"Plate_{s:+.0f}", (0.52, 0.01, 0.112), w(s, 0, z), col, radius=0.004)
        plate.data.materials.append(pal["plate"])
        made.append(plate)
        dy = -0.007 if s > 0 else 0.007
        made.append(text_mesh(f"PlateText_{s:+.0f}", "CB 100", 0.075, w(s, 0, z - 0.028) + Vector((0, dy, 0)),
                              (math.pi / 2, 0, facing), pal["interior"], col, 0.001))
    # chrome lettering across the tail
    made.append(text_mesh("Lettering", "COACH BLUE", 0.045, w(tail_surface(body, 0.765) + 0.004, 0, 0.765),
                          (math.pi / 2, 0, math.pi), pal["chrome"], col, 0.003))
    return made


def wipers(pal, col):
    made = []
    for x in (0.36, -0.12):
        arm = rounded_box(f"Wiper_{x}", (0.62, 0.012, 0.014), w(0.68, x, float(zdeck(0.68)) + 0.02), col,
                          radius=0.003, rot=(math.radians(-24), 0, math.radians(8)))
        arm.data.materials.append(pal["plastic"])
        made.append(arm)
    return made


def shut_lines(skin, pal, col):
    """Bonnet and boot shut lines as fine dark grooves laid on the paint.

    Diagonal slots cut through the finely divided shell step across its
    faces and come out saw-toothed; a thin matte-black tube pressed half into
    the surface reads as the same dark gap and stays clean along any curve.
    """
    lines = []
    for sx in (1, -1):
        lines.append([(0.76, sx * 0.8), (1.2, sx * 0.77), (1.55, sx * 0.7), (1.8, sx * 0.55), (1.95, sx * 0.4)])
    lines.append([(0.76, x) for x in np.linspace(-0.8, 0.8, 17)])
    lines.append([(1.95, x) for x in np.linspace(-0.4, 0.4, 9)])
    lines.append([(-1.66, x) for x in np.linspace(-0.8, 0.8, 17)])
    for sx in (1, -1):
        lines.append([(-1.66, sx * 0.8), (-1.9, sx * 0.77), (-2.08, sx * 0.72)])
    made = []
    inv = skin.matrix_world.inverted()
    for k, line in enumerate(lines):
        pts = []
        for (s0, x0), (s1, x1) in zip(line, line[1:]):
            for t in np.linspace(0, 1, 12, endpoint=False):
                s, x = s0 + (s1 - s0) * t, x0 + (x1 - x0) * t
                probe = w(s, x, 1.6)
                ok, loc, nrm, _ = skin.closest_point_on_mesh(inv @ probe)
                # drop straight down onto the top surface
                hit = skin.ray_cast(inv @ probe, Vector((0, 0, -1)))
                if hit[0]:
                    pts.append(tuple(skin.matrix_world @ hit[1]))
        s, x = line[-1]
        hit = skin.ray_cast(inv @ w(s, x, 1.6), Vector((0, 0, -1)))
        if hit[0]:
            pts.append(tuple(skin.matrix_world @ hit[1]))
        if len(pts) > 1:
            made.append(emitter_strip(f"ShutLine_{k}", pts, 0.0024, pal["interior"], col))
    return made


def build(col, pal, ctx):
    body, skin = ctx["body"]["body"], ctx["body"]["skin"]
    made = []
    made += headlights(body, skin, pal, col)
    made += taillights(body, skin, pal, col)
    made += intakes(body, pal, col)
    made += aero(pal, col)
    made += liners(pal, col)
    made += mirrors(pal, col)
    made += handles(pal, col)
    made += plates_and_badges(pal, col, body)
    made += wipers(pal, col)
    made += shut_lines(skin, pal, col)
    bpy.data.objects.remove(skin, do_unlink=True)
    print("PARTS", len(made))
    return made
