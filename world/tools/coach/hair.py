"""Hair as real strands: Blender hair curves grown from the scalp surface.

Four systems, all rigid to the head bone:
  CB_Hair_Top    tight coils gathered into clumps, the texture in the photo;
                 an envelope keeps the block's shape short and neat at the edge
  CB_Hair_Fade   the skin fade: bare at the nape, lengthening to ~6 mm at the
                 fade line, lying back along the scalp
  CB_Brows       short strands combed outward and lying flat
  CB_Lashes      grown from MakeHuman's lash-line helpers
  CB_Stubble     a sparse shadow on the upper lip, chin and jaw

The scalp shading mask m_scalp is repainted here to match, so the skin
under the fade reads darker with the stubble, as it does on a real fade.
"""
import bpy, math
import numpy as np
from common import (body, collection, group_weights, landmarks, move_to, rest_coords,
                    rig, set_point_attr)

RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- surface
def surface(obj):
    """Rest-pose triangles with per-corner vertex indices."""
    co = rest_coords(obj)
    me = obj.data
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tris)
    tris = tris.reshape(-1, 3)
    # MakeHuman's invisible helper shells (tights, skirt, hair, eyebrow
    # fitting geometry) share this mesh; nothing may grow on them
    helper = group_weights(obj, "HelperGeometry") > 0.5
    return co, tris[~helper[tris].any(axis=1)]


def sample(co, tris, weight, count):
    """Area x weight sampling. `weight` is per vertex. Returns points, normals, bary."""
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    cross = np.cross(b - a, c - a)
    area = np.linalg.norm(cross, axis=1) * 0.5
    w = weight[tris].mean(axis=1) * area
    if w.sum() <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, dtype=int), np.zeros((0, 3))
    pick = RNG.choice(len(tris), size=count, p=w / w.sum())
    u, v = RNG.random(count), RNG.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]
    n = cross[pick] / (np.linalg.norm(cross[pick], axis=1, keepdims=True) + 1e-12)
    bary = np.stack([1 - u - v, u, v], axis=1)
    return pts, n, pick, bary


def interp(values, tris, pick, bary):
    return (values[tris[pick]] * bary).sum(axis=1)


def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


# ---------------------------------------------------------------- output
def make_curves(name, strands, radius_root, radius_tip, material, col):
    """strands: array (count, points, 3)."""
    count, npts, _ = strands.shape
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([npts] * count)
    cv.attributes["position"].data.foreach_set("vector", strands.reshape(-1).astype(np.float32))
    rad = cv.attributes.get("radius") or cv.attributes.new("radius", "FLOAT", "POINT")
    taper = np.linspace(radius_root, radius_tip, npts, dtype=np.float32)
    rad.data.foreach_set("value", np.tile(taper, count))
    cv.materials.append(material)
    obj = bpy.data.objects.new(name, cv)
    col.objects.link(obj)
    obj.data.surface = body()
    r = rig()
    obj.parent = r
    obj.parent_type = "BONE"
    obj.parent_bone = "head"
    bpy.context.view_layer.update()
    # strand positions are in world space; cancel the bone parent transform
    obj.matrix_parent_inverse = obj.matrix_world.inverted() @ obj.matrix_parent_inverse
    return obj


def hair_material(name, melanin=1.0, redness=0.12, rough=0.36, radial=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new("ShaderNodeOutputMaterial")
    h = t.nodes.new("ShaderNodeBsdfHairPrincipled")
    h.parametrization = "MELANIN"
    h.inputs["Melanin"].default_value = melanin
    h.inputs["Melanin Redness"].default_value = redness
    h.inputs["Roughness"].default_value = rough
    h.inputs["Radial Roughness"].default_value = radial
    h.inputs["Coat"].default_value = 0.05
    h.inputs["Random Color"].default_value = 0.08
    h.inputs["Random Roughness"].default_value = 0.2
    t.links.new(h.outputs[0], out.inputs["Surface"])
    return m


# ---------------------------------------------------------------- systems
def top_coils(co, tris, frame, zone_top, envelope):
    """Clumped helices. Clump centres are sampled first; strands gather round them."""
    n_clumps, per_clump, npts = 3600, 7, 30
    cpts, cn, cpick, cbary = sample(co, tris, zone_top, n_clumps)
    thick = interp(envelope, tris, cpick, cbary)
    up, fwd = frame["up"], frame["fwd"]
    out = []
    for i in range(n_clumps):
        p, n, t = cpts[i], cn[i], thick[i]
        if t < 0.002:
            continue
        # the axis stands off the scalp, leaning a little forward and up like the photo
        axis = unit(n * 0.8 + up * 0.25 + fwd * 0.1)
        side = unit(np.cross(axis, fwd if abs(axis @ fwd) < 0.9 else up))
        other = np.cross(axis, side)
        pitch = RNG.uniform(0.0032, 0.0045)
        crad = RNG.uniform(0.0014, 0.0024)
        phase0 = RNG.uniform(0, 2 * math.pi)
        length = t * RNG.uniform(0.85, 1.1)
        for k in range(per_clump):
            off = (RNG.normal(0, 0.0012), RNG.normal(0, 0.0012))
            root = p + side * off[0] + other * off[1] - n * 0.0004
            s = np.linspace(0, 1, npts)[:, None]
            turns = length / pitch
            theta = phase0 + RNG.normal(0, 0.35) + s * turns * 2 * math.pi
            ramp = np.clip(s / 0.18, 0, 1)
            r = crad * ramp * RNG.uniform(0.8, 1.15)
            wob = RNG.normal(0, 0.0004, (npts, 3)) * ramp
            pts = (root + axis * (length * s) + side * (r * np.cos(theta))
                   + other * (r * np.sin(theta)) + wob)
            out.append(pts)
    return np.array(out)


def fade(co, tris, frame, zone_fade, fade_t):
    """Very short strands lying back and down along the scalp."""
    count, npts = 60000, 3
    pts, n, pick, bary = sample(co, tris, zone_fade, count)
    t = interp(fade_t, tris, pick, bary)          # 0 at the nape, 1 at the fade line
    keep = RNG.random(count) < (0.08 + 0.7 * t ** 2)
    pts, n, t = pts[keep], n[keep], t[keep]
    length = 0.0003 + 0.0045 * t ** 1.6
    down_back = unit(-frame["up"] * 0.7 - frame["fwd"] * 0.5)
    tang = unit(down_back - np.sum(down_back * n, axis=1, keepdims=True) * n)
    d = unit(tang * 0.85 + n * 0.3 + RNG.normal(0, 0.15, tang.shape))
    s = np.linspace(0, 1, npts)[None, :, None]
    return pts[:, None, :] - n[:, None, :] * 0.0002 + d[:, None, :] * length[:, None, None] * s


BROW_INNER, BROW_OUTER = -0.022, 0.03
from profile import P as _PROFB
BROW = _PROFB.get("brow", 1.0)


def brow_weight(co, lm, side, sign):
    """Density of one eyebrow per vertex: an arched band above the eye.
    Shared with the game export, which paints the same band into the skin."""
    e = lm[f"eye_{side}"]
    x = (co[:, 0] - e[0]) * sign                 # + is outward
    tpos = np.clip((x - BROW_INNER) / (BROW_OUTER - BROW_INNER), 0, 1)
    arch_z = e[2] + 0.016 + 0.002 * np.sin(tpos * math.pi * 0.8) - 0.003 * tpos
    width = 0.0055 - 0.0022 * tpos
    front = co[:, 1] < e[1] + 0.005
    inband = (x > BROW_INNER) & (x < BROW_OUTER) & front
    wv = np.where(inband, np.exp(-((co[:, 2] - arch_z) / width) ** 4), 0.0)
    return wv * (1.0 - 0.5 * tpos)


def brows(co, tris, lm, frame):
    out = []
    inner, outer = BROW_INNER, BROW_OUTER
    for side, sign in (("l", 1), ("r", -1)):
        e = lm[f"eye_{side}"]
        wv = brow_weight(co, lm, side, sign)
        pts, n, pick, bary = sample(co, tris, wv, int(1250 * BROW))
        xs = (pts[:, 0] - e[0]) * sign
        tp = np.clip((xs - inner) / (outer - inner), 0, 1)
        lateral = np.array([sign, 0, 0.0])
        d = unit(lateral[None, :] * (0.35 + 0.65 * tp[:, None])
                 + frame["up"][None, :] * (0.9 - 0.8 * tp[:, None]))
        d = unit(d - np.sum(d * n, axis=1, keepdims=True) * n + n * 0.12)
        length = RNG.uniform(0.006, 0.011, len(pts)) * (0.55 + 0.45 * BROW)
        s = np.linspace(0, 1, 5)[None, :, None]
        curl = (n * 0.0012)[:, None, :] * np.sin(s * math.pi)
        out.append(pts[:, None, :] + d[:, None, :] * length[:, None, None] * s + curl)
    return np.concatenate(out)


def lashes(co, lm, frame, obj):
    out = []
    for side in ("l", "r"):
        for row, (length, lift) in (("1", (0.0085, 1.0)), ("2", (0.0045, -0.6))):
            w = group_weights(obj, f"helper-{side}-eyelashes-{row}") > 0.5
            ring = co[w]
            if len(ring) == 0:
                continue
            e = lm[f"eye_{side}"]
            # the helper is a lash band; its front-most edge is the lid margin
            margin = ring[ring[:, 1] < np.percentile(ring[:, 1], 40)]
            idx = RNG.integers(0, len(margin), 110)
            roots = margin[idx] + RNG.normal(0, 0.0003, (110, 3))
            out_dir = unit(roots - e)
            for i, r in enumerate(roots):
                L = length * RNG.uniform(0.7, 1.1)
                d = unit(out_dir[i] * 0.6 + frame["fwd"] * 0.6 + frame["up"] * 0.5 * lift)
                s = np.linspace(0, 1, 6)[:, None]
                bend = frame["up"] * (0.35 * lift) * L * s ** 2
                out.append(r + d * L * s + bend)
    return np.array(out)


def stubble_weight(co, lm, obj):
    """Density of the beard shadow per vertex (shared with the game export)."""
    lips = group_weights(obj, "lips")
    nose = lm["nose"]
    eye_z = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
    front = co[:, 1] < nose[1] + 0.07
    below_nose = co[:, 2] < nose[2] - 0.012
    above_neck = co[:, 2] > nose[2] - 0.095
    mustache = np.exp(-((co[:, 2] - (nose[2] - 0.022)) / 0.008) ** 2) * (np.abs(co[:, 0]) < 0.028)
    chin = np.exp(-((co[:, 2] - (nose[2] - 0.075)) / 0.018) ** 2) * (np.abs(co[:, 0]) < 0.035)
    w = (mustache * 1.0 + chin * 0.7 + 0.12) * front * below_nose * above_neck * (lips < 0.05)
    return w * (co[:, 2] < eye_z - 0.05)


def stubble(co, tris, lm, frame, obj):
    w = stubble_weight(co, lm, obj)
    pts, n, pick, bary = sample(co, tris, w, 9000)
    d = unit(n * 0.45 - frame["up"][None, :] * 0.8 + RNG.normal(0, 0.2, n.shape))
    length = RNG.uniform(0.0006, 0.0017, len(pts))
    s = np.linspace(0, 1, 3)[None, :, None]
    return pts[:, None, :] - n[:, None, :] * 0.0002 + d[:, None, :] * length[:, None, None] * s


# ---------------------------------------------------------------- zones
def zones(co, obj, lm):
    scalp = group_weights(obj, "scalp")
    eye_z = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
    eye_y = (lm["eye_l"][1] + lm["eye_r"][1]) / 2
    head_c = np.array([0.0, eye_y + 0.075, eye_z + 0.03])
    rel = co - head_c
    # the fade line sits about 4.5 cm over the eyes on the sides and back,
    # and the lined-up front edge about 7 cm over them at the brow
    frontness = np.clip(-rel[:, 1] / 0.09, 0, 1)           # 1 at the forehead
    line_z = eye_z + 0.047 + 0.022 * frontness ** 2
    temple_cut = (frontness > 0.72) & (np.abs(rel[:, 0]) > 0.052)   # recessed temples
    above = co[:, 2] - line_z
    head_region = (group_weights(obj, "head") > 0.3) & (group_weights(obj, "HelperGeometry") < 0.5)
    ears = group_weights(obj, "ears") > 0.1
    face_front = (rel[:, 1] < -0.06) & (co[:, 2] < eye_z + 0.072)

    top = np.where((above > 0) & head_region & ~face_front & ~temple_cut & ~ears, 1.0, 0.0)
    # the envelope: fullest at the crown, cut short at the edges so the block is neat
    env = np.clip(above / 0.03, 0, 1) ** 0.6 * (0.024 + 0.012 * np.clip(rel[:, 2] / 0.1, 0, 1))
    env *= 1.0 - 0.25 * frontness
    fade_band = (above <= 0) & (above > -0.075) & head_region & ~face_front & ~ears
    fade_band |= (above > 0) & temple_cut & head_region
    fade_t = np.clip(1 + above / 0.075, 0, 1)
    fade_w = np.where(fade_band, 1.0, 0.0)
    # scalp shading: the top block and the upper fade darken the skin
    shade = np.clip(top * 0.9 + fade_band * fade_t * 0.75, 0, 1)
    return top, env, fade_w, fade_t, shade


# ---------------------------------------------------------------- styles
from profile import P as PROF
STYLE = PROF["hair"]["style"]


def head_frame(lm):
    eye_z = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
    eye_y = (lm["eye_l"][1] + lm["eye_r"][1]) / 2
    return np.array([0.0, eye_y + 0.075, eye_z + 0.03]), eye_z


def style_zones(co, obj, lm):
    """(mask, envelope) of the hair for this profile's style.

    coils    the coach's own: block on top, skin fade below (see zones())
    buzz     every scalp zone, a few millimetres all over
    straight top and the upper sides, 3-6 cm, lying back
    ponytail the whole scalp drawn back tight to a tie at the crown
    """
    top, env, fade_w, fade_t, shade = zones(co, obj, lm)
    if STYLE == "coils":
        return top, env, shade
    # everything above the ears is hair for the other styles
    # above the ears, and never at the temples or brow: long hair grows from
    # the hairline back, not down the side of the face
    centre, eye_z = head_frame(lm)
    rel_y = co[:, 1] - centre[1]
    temple = (np.abs(co[:, 0]) > 0.045) & (rel_y < -0.02) & (co[:, 2] < eye_z + 0.085)
    hairline = ((top > 0) | ((fade_w > 0) & (fade_t > 0.3))) & ~temple & (co[:, 2] > eye_z + 0.03)
    mask = hairline.astype(float)
    if STYLE == "buzz":
        env = np.full(len(co), 0.004)
    elif STYLE == "straight":
        rise = np.clip((co[:, 2] - (eye_z + 0.04)) / 0.08, 0, 1)
        env = (0.008 + 0.014 * rise) * mask
    else:                          # ponytail: pulled flat to the head
        env = np.full(len(co), 0.005)
    shade = np.clip(mask * 0.85, 0, 1)
    return mask, env * mask, shade


_BVH = {}


def scalp_bvh(co, tris):
    from mathutils.bvhtree import BVHTree
    key = id(tris)
    if key not in _BVH:
        _BVH[key] = BVHTree.FromPolygons([tuple(c) for c in co], [tuple(t) for t in tris])
    return _BVH[key]


def lie_strands(co, tris, mask, frame, count, length, curl, target=None, clump=0.0):
    """Strands combed along the scalp toward `target` (or back and down).

    Each strand is walked over the head a few millimetres at a time and
    snapped back to just above the skin after every step, so it follows the
    curve of the skull the way combed hair does instead of leaving it in a
    straight line and sticking out.
    """
    from mathutils import Vector
    bvh = scalp_bvh(co, tris)
    pts, n, pick, bary = sample(co, tris, mask, count)
    out = []
    K = 8
    for i in range(len(pts)):
        p = Vector(pts[i])
        L = length * RNG.uniform(0.75, 1.15)
        if target is not None:
            L = min(L, (Vector(target) - p).length * 0.98)
        step = L / (K - 1)
        side = RNG.normal(0, 0.12)
        strand = []
        for k in range(K):
            loc, nrm, _, _ = bvh.find_nearest(p)
            if loc is None:
                break
            nrm = nrm.normalized()
            h = 0.0012 + 0.0025 * np.sin(k / (K - 1) * np.pi) * (1 + curl) + 0.0006 * k
            q = loc + nrm * h
            strand.append(tuple(q))
            if target is not None:
                d = Vector(target) - q
            else:
                d = Vector((side, 0, 0)) - Vector(frame["fwd"]) * 0.7 - Vector(frame["up"]) * 0.5
            d = d - nrm * d.dot(nrm)
            if d.length < 1e-6:
                break
            d.normalize()
            if curl:
                d += nrm.cross(d) * np.sin(k * 1.9) * 0.15 * curl
            p = q + d * step
        while len(strand) < K:
            strand.append(strand[-1])
        out.append(strand)
    return np.array(out)


def tie_point(lm, co=None, tris=None):
    """High on the back of the crown, on the scalp itself: a ray from the
    middle of the head, up and back, to where it leaves the skull."""
    from mathutils import Vector
    centre, eye_z = head_frame(lm)
    if co is None:
        return centre + np.array([0, 0.085, 0.07])
    bvh = scalp_bvh(co, tris)
    o = Vector(centre)
    d = Vector((0, 0.75, 0.66)).normalized()
    # cast from outside in, so the hit is the outer surface
    hit = bvh.ray_cast(o + d * 0.4, -d, 0.6)
    if hit[0] is None:
        return centre + np.array([0, 0.085, 0.07])
    return np.array(hit[0] + hit[1].normalized() * 0.012)


def tail_strands(tie, count=1400):
    """The ponytail: gathered at the tie, falling back and down, swinging out a little."""
    out = []
    for _ in range(count):
        r0 = abs(RNG.normal(0, 0.006))
        a = RNG.uniform(0, 2 * np.pi)
        L = RNG.uniform(0.26, 0.34)
        spread = RNG.uniform(0.02, 0.045)
        pts = []
        for t in np.linspace(0, 1, 10):
            # out from the tie, then falling: a gentle S down the back of the head
            back = 0.05 * np.sin(t * np.pi * 0.6) + 0.02 * t
            down = -L * t
            r = r0 + spread * np.sin(t * np.pi * 0.9) ** 0.8
            pts.append(tie + np.array([np.cos(a) * r, back + np.sin(a) * r * 0.6, down]))
        out.append(pts)
    return np.array(out)


def tail_mesh(tie, material, col):
    """The same ponytail as a tapered, lightly flattened tube, for the game."""
    import bmesh
    bm = bmesh.new()
    rings = []
    for t in np.linspace(0, 1, 12):
        back = 0.05 * np.sin(t * np.pi * 0.6) + 0.02 * t
        c = tie + np.array([0, back, -0.3 * t])
        r = 0.012 + 0.03 * np.sin(t * np.pi * 0.9) ** 0.8 * (1 - 0.5 * t)
        ring = []
        for k in range(10):
            a = k / 10 * 2 * np.pi
            ring.append(bm.verts.new(c + np.array([np.cos(a) * r, np.sin(a) * r * 0.7, 0])))
        rings.append(ring)
    for a_, b_ in zip(rings, rings[1:]):
        for k in range(10):
            j = (k + 1) % 10
            bm.faces.new((a_[k], a_[j], b_[j], b_[k]))
    bm.faces.new(rings[-1][::-1])
    me = bpy.data.meshes.new("CB_Ponytail")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("CB_Ponytail", me)
    col.objects.link(o)
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = True
    return o


def apply():
    obj = body()
    co, tris = surface(obj)
    lm = landmarks(obj)
    frame = {"up": np.array([0, 0, 1.0]), "fwd": np.array([0, -1.0, 0])}
    top, env, fade_w, fade_t, shade = zones(co, obj, lm)
    set_point_attr(obj, "m_scalp", shade)

    col = collection("HAIR", collection("GAME_MESH"))
    m_lash = hair_material("M_Lashes", melanin=1.0, rough=0.3)

    made = {}
    mel, red = PROF["hair"]["melanin"], PROF["hair"]["redness"]
    m_hair = hair_material("M_Hair", melanin=mel, redness=red)
    m_short = hair_material("M_HairShort", melanin=mel, redness=red, rough=0.6, radial=0.3)
    mask, henv, shade = style_zones(co, obj, lm)
    if STYLE == "coils":
        s = top_coils(co, tris, frame, top, env)
        made["top"] = make_curves("CB_Hair_Top", s, 0.00009, 0.00005, m_hair, col)
        s = fade(co, tris, frame, fade_w, fade_t)
        made["fade"] = make_curves("CB_Hair_Fade", s, 0.00006, 0.00003, m_short, col)
    else:
        set_point_attr(obj, "m_scalp", shade)
        if STYLE == "buzz":
            s = lie_strands(co, tris, mask, frame, 70000, 0.004, 0.0)
            made["top"] = make_curves("CB_Hair_Top", s, 0.00005, 0.00003, m_short, col)
        elif STYLE == "straight":
            # combed back off the forehead toward the crown
            centre, _ = head_frame(lm)
            s = lie_strands(co, tris, mask, frame, 26000, 0.07, 0.25, target=centre + np.array([0, 0.24, 0.02]))
            made["top"] = make_curves("CB_Hair_Top", s, 0.00007, 0.00004, m_hair, col)
        else:
            tie = tie_point(lm, co, tris)
            s = lie_strands(co, tris, mask, frame, 30000, 0.2, 0.05, target=tie)
            made["top"] = make_curves("CB_Hair_Top", s, 0.00006, 0.00004, m_hair, col)
            made["tail"] = make_curves("CB_Ponytail_Strands", tail_strands(tie), 0.00008, 0.00004, m_hair, col)
    s = brows(co, tris, lm, frame)
    made["brows"] = make_curves("CB_Brows", s, 0.00006, 0.00002, m_short, col)
    s = lashes(co, lm, frame, obj)
    if len(s):
        made["lashes"] = make_curves("CB_Lashes", s, 0.00005, 0.00001, m_lash, col)
    if PROF["stubble"]:
        s = stubble(co, tris, lm, frame, obj)
        made["stubble"] = make_curves("CB_Stubble", s, 0.00004, 0.00002, m_short, col)
    for k, o in made.items():
        print("HAIR", k, len(o.data.curves), "strands")
    return made
