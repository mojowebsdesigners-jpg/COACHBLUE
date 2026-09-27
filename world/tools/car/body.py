"""The body shell: one lofted surface, subdivided, then cut like sheet metal.

Every cross-section is 13 points around half the car — floor, sill corner,
the door's lower bulge, the widest point, the shoulder crease, and then either
the bonnet/deck or the greenhouse (window line, roof rail, roof). The
greenhouse fades in and out with the roofline, so the windscreen and the
fastback grow out of the bonnet and the deck instead of being stuck on.

After subdivision the shell is cut: glass faces are split off into their own
object (so the glass fits its opening exactly), the wheel arches are bored out,
and the shut lines are real slots through the metal, which read as shut lines
from any angle because there is darkness behind them. A Solidify gives the
panels thickness, a dark inside, and a black rim round every opening.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector
from common import (ARCH_R, FRONT_AXLE, REAR_AXLE, TYRE_R, apply_modifiers, boolean,
                    collection, link, mesh_obj, smooth, w)

# ---------------------------------------------------------------- profiles
# plan view: a narrow nose, a waist at the doors, muscular rear haunches
hw = smooth([-2.24, -2.15, -2.0, -1.75, -1.35, -0.95, -0.4, 0.2, 0.7, 1.1, 1.35, 1.7, 1.98, 2.15, 2.26],
            [0.60, 0.78, 0.90, 0.962, 0.978, 0.955, 0.915, 0.905, 0.918, 0.938, 0.946, 0.928, 0.868, 0.74, 0.52])
# the floor line. Behind the rear arches it lifts well clear of the road, as
# a real car's bumper does, so the tyres show beneath it from behind instead
# of the body running down to the tarmac like a skirt
zb = smooth([-2.24, -2.1, -1.95, -1.75, 1.75, 2.05, 2.26], [0.47, 0.44, 0.32, 0.17, 0.16, 0.2, 0.25])
# the shoulder crease: low at the nose, rising to the rear haunch
zsh = smooth([-2.24, -2.0, -1.4, -0.7, 0.4, 1.35, 1.95, 2.26],
             [0.80, 0.86, 0.88, 0.83, 0.79, 0.765, 0.71, 0.60])
# bonnet and deck, with a ducktail at the very back
zdeck = smooth([-2.24, -2.12, -1.95, -1.6, 0.0, 0.7, 1.2, 1.7, 2.05, 2.2, 2.26],
               [0.86, 0.95, 0.94, 0.925, 0.88, 0.87, 0.82, 0.755, 0.68, 0.62, 0.56])
_roof = smooth([0.7, 0.45, 0.2, -0.05, -0.35, -0.7, -1.0, -1.3, -1.62],
               [0.875, 1.0, 1.13, 1.24, 1.285, 1.265, 1.18, 1.06, 0.935])
# the sculpted lower door: a shallow concave run between the arches
scoop = smooth([-1.1, -0.9, -0.5, 0.2, 0.55, 0.75], [0.0, 0.02, 0.03, 0.03, 0.02, 0.0])


def zroof(s):
    return np.where((s < 0.7) & (s > -1.62), _roof(s), -1.0)


def cabin(s):
    return np.clip((np.maximum(zroof(s), zdeck(s)) - zdeck(s)) / 0.1, 0, 1)


def half_section(s):
    """13 (x, z) points around the right half of the section at station s."""
    H, B, SH, D = float(hw(s)), float(zb(s)), float(zsh(s)), float(zdeck(s))
    T = float(max(zroof(s), D))
    c = float(cabin(s))
    sc = float(scoop(s))
    lower = [(0.0, B), (H * 0.55, B), (H - 0.05 - sc * 0.6, B + 0.015), (H - 0.006 - sc, B + 0.12),
             (H, B + 0.34 if B + 0.34 < SH - 0.12 else (B + SH) / 2), (H - 0.012, SH - 0.1),
             (H - 0.036, SH)]
    deck = [(H - 0.12, SH + (D - SH) * 0.7 + 0.01), (H * 0.72, D - 0.004), (H * 0.5, D),
            (H * 0.28, D + 0.004), (H * 0.12, D + 0.006), (0.0, D + 0.006)]
    gb, gr = H - 0.13, 0.6
    house = [(gb, SH + 0.022), (gb + (gr - gb) * 0.75, SH + (T - SH) * 0.8),
             (gr, T - 0.036), (gr * 0.62, T - 0.009), (gr * 0.3, T), (0.0, T)]
    top = [(d[0] + (h[0] - d[0]) * c, d[1] + (h[1] - d[1]) * c) for d, h in zip(deck, house)]
    return lower + top


STATIONS = np.concatenate([
    np.linspace(2.28, 1.9, 6), np.linspace(1.82, 0.74, 9), np.linspace(0.66, -0.1, 9),
    np.linspace(-0.2, -0.7, 4), np.linspace(-0.8, -1.6, 8), np.linspace(-1.7, -2.24, 7)])

SEG_SIDE_WINDOW = 7
SEG_ROOF_RAIL = 8
SEGS_TOP = (9, 10, 11)
M_PAINT, M_INTERIOR, M_TRIM, M_GLASS = 0, 1, 2, 3


def face_material(seg, s, c):
    if seg == SEG_SIDE_WINDOW and c > 0.72 and -1.02 < s < 0.5:
        return M_GLASS
    if seg in SEGS_TOP and -0.03 < s < 0.64 and c > 0.05:
        return M_GLASS        # windscreen
    if seg in SEGS_TOP and -1.55 < s < -0.84:
        return M_GLASS        # the fastback's rear glass
    return M_PAINT


def loft(col, pal):
    bm = bmesh.new()
    crease = bm.edges.layers.float.new("crease_edge")
    rings = []
    for s in STATIONS:
        pts = half_section(s)
        right = [bm.verts.new(w(s, x, z)) for x, z in pts]
        left = [bm.verts.new(w(s, -x, z)) for x, z in pts[1:-1]][::-1]
        rings.append(right + left)          # 13 + 11 = 24, a closed loop
    n = len(rings[0])
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        s_mid = (STATIONS[k] + STATIONS[k + 1]) / 2
        c = float(cabin(s_mid))
        for j in range(n):
            f = bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
            seg = j if j < 12 else 23 - j
            f.material_index = face_material(seg, s_mid, c)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # character lines: a crisp shoulder crease, a firm sill, a soft roof rail
    bm.verts.index_update()
    for k in range(len(rings) - 1):
        for p, amount in ((6, 0.75), (2, 0.45), (9, 0.25)):
            for side in (p, n - p) if p not in (0, 12) else (p,):
                if side >= n:
                    continue
                e = bm.edges.get((rings[k][side], rings[k + 1][side]))
                if e:
                    e[crease] = amount
    o = mesh_obj("Body", bm, col)
    for key in ("paint", "interior", "trim", "glass"):
        o.data.materials.append(pal[key])
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 3
    apply_modifiers(o)
    return o


def split_glass(body, col, pal):
    """Glass faces become their own object, set a few mm into the opening."""
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    body.active_material_index = M_GLASS
    bpy.ops.object.material_slot_select()
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    glass = [o for o in bpy.context.selected_objects if o is not body][0]
    glass.name = "Glass"
    glass.data.materials.clear()
    glass.data.materials.append(pal["glass"])
    me = glass.data
    for v in me.vertices:
        v.co -= v.normal * 0.006
    body.data.materials.pop(index=M_GLASS)
    link(glass, col)
    return glass


def slot_cutter(name, polyline, plane, extent, width, col):
    """Thin slabs along a polyline, one closed box per segment, used to cut a
    shut line. Separate boxes keep every cutter manifold, which the exact
    boolean needs; one mesh of overlapping boxes makes it carve out volumes.

    plane 'side': polyline in (s, z), swept along x over `extent`;
    plane 'top': polyline in (s, x), swept along z over `extent`.
    """
    out = []
    for (a0, b0), (a1, b1) in zip(polyline, polyline[1:]):
        d = np.array([a1 - a0, b1 - b0], float)
        d /= np.linalg.norm(d)
        nrm = np.array([-d[1], d[0]]) * width / 2
        p0 = np.array([a0, b0]) - d * width * 0.5
        p1 = np.array([a1, b1]) + d * width * 0.5
        quad = [p0 + nrm, p1 + nrm, p1 - nrm, p0 - nrm]
        bm = bmesh.new()
        vs = []
        for e in extent:
            for q in quad:
                vs.append(bm.verts.new(w(q[0], e, q[1]) if plane == "side" else w(q[0], q[1], e)))
        bm.faces.new((vs[0], vs[1], vs[2], vs[3]))
        bm.faces.new((vs[7], vs[6], vs[5], vs[4]))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((vs[i], vs[4 + i], vs[4 + j], vs[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        out.append(mesh_obj(name, bm, col, smooth=False))
    return out


def cut_arches(body, col):
    for s_ax in (FRONT_AXLE, REAR_AXLE):
        for side in (1, -1):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=72, radius1=ARCH_R, radius2=ARCH_R,
                                  depth=0.9)
            cut = mesh_obj("arch", bm, col)
            cut.rotation_euler = (0, math.pi / 2, 0)
            cut.location = w(s_ax, side * 1.05, TYRE_R + 0.01)
            bpy.context.view_layer.update()
            boolean(body, cut)


def cut_shut_lines(body, col):
    SH = lambda s: float(zsh(s))
    width = 0.0045
    cuts = []
    for side in (1, -1):
        x0, x1 = side * 0.35, side * 1.2
        # front and rear door edges; the bottom edge is hidden by the sill cover
        for edge in ([(0.64, SH(0.64) + 0.06), (0.67, 0.55), (0.64, 0.3)],
                     [(-0.78, 0.3), (-0.8, 0.55), (-0.86, SH(-0.86) + 0.06)]):
            cuts += slot_cutter("door", edge, "side", (x0, x1), width, col)
    for c in cuts:
        boolean(body, c)


def thicken(body):
    sol = body.modifiers.new("panel", "SOLIDIFY")
    sol.thickness = 0.012
    sol.offset = -1.0
    sol.use_rim = True
    sol.use_even_offset = True
    sol.material_offset = M_INTERIOR
    # the inside of every cut is matte black, so shut lines read as dark gaps
    sol.material_offset_rim = M_INTERIOR
    apply_modifiers(body)


def build(col, pal):
    body = loft(col, pal)
    glass = split_glass(body, col, pal)
    cut_arches(body, col)
    cut_shut_lines(body, col)
    # the unthickened surface, kept so lamp lenses can be cut from the exact skin
    skin = body.copy()
    skin.data = body.data.copy()
    skin.name = "BodySkin"
    col.objects.link(skin)
    skin.hide_render = True
    thicken(body)
    for p in body.data.polygons:
        p.use_smooth = True
    print(f"BODY verts={len(body.data.vertices)} glass={len(glass.data.vertices)}")
    return {"body": body, "glass": glass, "skin": skin}
