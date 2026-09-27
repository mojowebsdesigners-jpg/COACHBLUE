"""Clothing as real garment geometry, lifted off the body and skinned to its rig.

Each garment starts as a copy of the body region it covers (so it inherits
the body's bone weights and deforms with the armature exactly as the skin
does), then becomes cloth:

  1. subdivided once, so seams and folds have geometry to live in
  2. pushed off the skin by a per-region ease profile
  3. relaxed with a Laplacian smooth, which is what makes fabric bridge
     hollows — the sternum, the abdominal grooves, the crotch — instead of
     shrink-wrapping every muscle the way painted-on clothing does
  4. folded: tension folds, soft stomach folds, knee and ankle stacking
  5. pushed back out anywhere it dipped inside the body
  6. given thickness with a Solidify, and a Subdivision for render

Seams are real grooves in the mesh plus stitch rows in the shader, read from
per-vertex seam-distance attributes computed here.
"""
import bpy, bmesh, heapq, math, os
import numpy as np
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree
from common import (body, bone_head, collection, group_weights, hex_lin, link, node,
                    rest_coords, rig, set_point_attr)

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.normpath(os.path.join(HERE, "..", "..", "raw", "coach_hero", "tex", "logo.png"))

from profile import P as PROF
TOP = PROF["top"]
BOTTOM = PROF["bottom"]
SHIRT_HEX = TOP["color"]
PANTS_HEX = BOTTOM["color"]
SHOE_HEX = PROF["shoes"]


# ================================================================ geometry
def rest_mesh_copy(src, name):
    """A new object whose mesh is `src` with shape keys applied, no armature pose."""
    saved = [(m, m.show_viewport) for m in src.modifiers]
    for m, _ in saved:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), preserve_all_data_layers=True,
                                         depsgraph=dg)
    for m, v in saved:
        m.show_viewport = v
    me.name = name
    obj = bpy.data.objects.new(name, me)
    for g in src.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    obj.matrix_world = src.matrix_world
    return obj


def keep_only(obj, keep):
    """Delete every vertex not in `keep`; records the source index as 'src'."""
    me = obj.data
    if "src" in me.attributes:
        me.attributes.remove(me.attributes["src"])
    a = me.attributes.new("src", "INT", "POINT")
    a.data.foreach_set("value", np.arange(len(me.vertices), dtype=np.int32))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    return int(keep.sum())


def plane_cut(obj, point, normal, region):
    """Cut an opening clean along a plane, deleting the side `normal` points to.

    `region` is a per-vertex mask limiting the cut to one part of the garment
    (a sleeve plane extended far enough would otherwise slice the torso too).
    Vertex groups and attributes are interpolated onto the new edge.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    faces = [f for f in bm.faces if all(region[v.index] for v in f.verts)]
    geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(point), plane_no=Vector(normal),
                           clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()


def cut_box(obj, planes):
    """Remove the region inside several half-spaces at once, with clean edges.

    Each plane (point, normal) splits the mesh without deleting anything; then
    the faces lying on the positive side of *every* plane are removed. That
    gives a clean corner where two cuts meet — a scoop neckline beside a strap
    — which one-plane-at-a-time cutting can only approximate with steps.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for pt, nv in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(pt), plane_no=Vector(nv))
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        if all((c - Vector(pt)).dot(Vector(nv)) > 0 for pt, nv in planes):
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def subdivide(obj, cuts=1):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True,
                              smooth=0.6)
    bm.to_mesh(obj.data)
    bm.free()


def arrays(obj):
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    me.update()
    nrm = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", nrm)
    ed = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ed)
    return co, nrm.reshape(-1, 3), ed.reshape(-1, 2)


def put(obj, co):
    obj.data.vertices.foreach_set("co", co.reshape(-1).astype(np.float32))
    obj.data.update()


def laplacian(co, edges, iters, factor, pinned=None, weight=None, taubin=True):
    """Taubin smoothing by default: alternating shrink/inflate steps smooth the
    surface without the volume loss of plain Laplacian smoothing, which would
    otherwise eat the garment's ease."""
    n = len(co)
    deg = np.bincount(edges.ravel(), minlength=n).astype(float)
    for _ in range(iters):
        acc = np.zeros_like(co)
        np.add.at(acc, edges[:, 0], co[edges[:, 1]])
        np.add.at(acc, edges[:, 1], co[edges[:, 0]])
        # loose vertices have no neighbours to average; leave them where they are
        avg = np.where((deg > 0)[:, None], acc / np.maximum(deg, 1)[:, None], co)
        f = factor if weight is None else factor * weight[:, None]
        if taubin and _ % 2 == 1:
            f = -f * 1.04
        new = co + (avg - co) * f
        if pinned is not None:
            new[pinned] = co[pinned]
        co = new
    return co


def boundary_verts(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    out = np.array([v.index for v in bm.verts if v.is_boundary], dtype=np.int64)
    bm.free()
    return out


def geodesic(co, edges, sources):
    """Dijkstra distance along the mesh from a set of source vertices."""
    n = len(co)
    adj = [[] for _ in range(n)]
    lengths = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
    for (a, b), l in zip(edges, lengths):
        adj[a].append((b, l))
        adj[b].append((a, l))
    dist = np.full(n, np.inf)
    heap = []
    for s in sources:
        dist[s] = 0.0
        heap.append((0.0, int(s)))
    heapq.heapify(heap)
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for w, l in adj[v]:
            nd = d + l
            if nd < dist[w]:
                dist[w] = nd
                heapq.heappush(heap, (nd, w))
    return dist


def push_outside(obj, target_bvh, gap, only=None):
    """Anything that fell inside the body (or closer than `gap`) is pushed out.
    `only` limits it to vertices near the openings: deeper in, the skin is
    masked, and pushing cloth over every small bump would undo the bridging."""
    co, nrm, _ = arrays(obj)
    for i, p in enumerate(co):
        if only is not None and not only[i]:
            continue
        hit = target_bvh.find_nearest(Vector(p))
        if hit[0] is None:
            continue
        loc, n, _, dist = hit
        d = Vector(p) - loc
        inside = d.dot(n) < 0
        if inside or dist < gap:
            co[i] = np.array(loc + n * gap)
    put(obj, co)


def body_bvh():
    co = rest_coords(body())
    me = body().data
    helpers = group_weights(body(), "HelperGeometry") > 0.5
    polys = [tuple(p.vertices) for p in me.polygons if not any(helpers[i] for i in p.vertices)]
    return BVHTree.FromPolygons([tuple(c) for c in co], polys)


def fbm(p, freq, octaves=3):
    v, amp, f = 0.0, 1.0, freq
    for _ in range(octaves):
        v += amp * noise.noise(Vector(p * f))
        amp *= 0.5
        f *= 2.0
    return v


def plane_dist(co, a, b, c):
    n = np.cross(np.asarray(b) - a, np.asarray(c) - a)
    n /= np.linalg.norm(n)
    return (co - a) @ n


# ================================================================ materials
def fabric_material(name, hex_col, knit_scale, sheen, rough, logo=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    t = mat.node_tree
    t.nodes.clear()
    out = node(t, "ShaderNodeOutputMaterial", (1500, 0))
    bsdf = node(t, "ShaderNodeBsdfPrincipled", (1200, 0))
    link(t, bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Sheen Roughness"].default_value = 0.4
    bsdf.inputs["Specular IOR Level"].default_value = 0.35

    tc = node(t, "ShaderNodeTexCoord", (-1500, 0))

    def attr(name, y):
        a = node(t, "ShaderNodeAttribute", (-1200, y))
        a.attribute_name = name
        return a.outputs["Fac"]

    # knit: two crossing fine waves read as a jersey or woven face up close
    k1 = node(t, "ShaderNodeTexWave", (-1000, -600), Scale=knit_scale, Distortion=0.6,
              Detail=1.0)
    k1.bands_direction = "Z"
    k2 = node(t, "ShaderNodeTexWave", (-1000, -800), Scale=knit_scale * 1.3, Distortion=0.6,
              Detail=1.0)
    k2.bands_direction = "X"
    for k in (k1, k2):
        link(t, tc.outputs["Object"], k.inputs["Vector"])
    kmul = node(t, "ShaderNodeMath", (-800, -700))
    kmul.operation = "MULTIPLY"
    link(t, k1.outputs["Fac"], kmul.inputs[0])
    link(t, k2.outputs["Fac"], kmul.inputs[1])
    fuzz = node(t, "ShaderNodeTexNoise", (-1000, -1000), Scale=knit_scale * 4, Detail=2.0)
    link(t, tc.outputs["Object"], fuzz.inputs["Vector"])

    # stitches: dashes along each seam, a row either side of the groove
    seam = attr("seam_d", -1200)
    along = attr("seam_u", -1400)
    rows = node(t, "ShaderNodeMapRange", (-900, -1200))
    rows.clamp = True
    link(t, seam, rows.inputs["Value"])
    rows.inputs["From Min"].default_value = 0.0035
    rows.inputs["From Max"].default_value = 0.0022
    rows_far = node(t, "ShaderNodeMapRange", (-900, -1350))
    rows_far.clamp = True
    link(t, seam, rows_far.inputs["Value"])
    rows_far.inputs["From Min"].default_value = 0.0035
    rows_far.inputs["From Max"].default_value = 0.0048
    band = node(t, "ShaderNodeMath", (-700, -1250))
    band.operation = "MINIMUM"
    link(t, rows.outputs[0], band.inputs[0])
    link(t, rows_far.outputs[0], band.inputs[1])
    dash_s = node(t, "ShaderNodeMath", (-900, -1500))
    dash_s.operation = "MULTIPLY"
    link(t, along, dash_s.inputs[0])
    dash_s.inputs[1].default_value = 1 / 0.0032      # 3.2 mm stitch pitch
    dash = node(t, "ShaderNodeMath", (-700, -1500))
    dash.operation = "PINGPONG"
    link(t, dash_s.outputs[0], dash.inputs[0])
    dash.inputs[1].default_value = 0.5
    dash_c = node(t, "ShaderNodeMath", (-550, -1500))
    dash_c.operation = "GREATER_THAN"
    link(t, dash.outputs[0], dash_c.inputs[0])
    dash_c.inputs[1].default_value = 0.18
    stitch = node(t, "ShaderNodeMath", (-400, -1350))
    stitch.operation = "MULTIPLY"
    link(t, band.outputs[0], stitch.inputs[0])
    link(t, dash_c.outputs[0], stitch.inputs[1])

    # ribbed collar and cuffs
    rib_w = node(t, "ShaderNodeTexWave", (-1000, -1700), Scale=knit_scale * 0.22,
                 Distortion=0.0, Detail=0.0)
    rib_w.bands_direction = "X"
    link(t, tc.outputs["Object"], rib_w.inputs["Vector"])
    rib = node(t, "ShaderNodeMath", (-700, -1700))
    rib.operation = "MULTIPLY"
    link(t, rib_w.outputs["Fac"], rib.inputs[0])
    link(t, attr("rib", -1800), rib.inputs[1])

    h1 = node(t, "ShaderNodeBump", (200, -700), Strength=0.25, Distance=0.00025)
    link(t, kmul.outputs[0], h1.inputs["Height"])
    h2 = node(t, "ShaderNodeBump", (400, -900), Strength=0.1, Distance=0.0002)
    link(t, fuzz.outputs["Fac"], h2.inputs["Height"])
    link(t, h1.outputs[0], h2.inputs["Normal"])
    h3 = node(t, "ShaderNodeBump", (600, -1100), Strength=0.6, Distance=0.0004)
    link(t, stitch.outputs[0], h3.inputs["Height"])
    link(t, h2.outputs[0], h3.inputs["Normal"])
    h4 = node(t, "ShaderNodeBump", (800, -1300), Strength=0.4, Distance=0.0006)
    link(t, rib.outputs[0], h4.inputs["Height"])
    link(t, h3.outputs[0], h4.inputs["Normal"])
    link(t, h4.outputs[0], bsdf.inputs["Normal"])

    # colour: slight tonal variation, stitches a touch lighter, folds hold dye darker
    base = node(t, "ShaderNodeRGB", (-400, 300))
    base.outputs[0].default_value = hex_lin(hex_col)
    var = node(t, "ShaderNodeMapRange", (-400, 100))
    link(t, fuzz.outputs["Fac"], var.inputs["Value"])
    var.inputs["To Min"].default_value = 0.9
    var.inputs["To Max"].default_value = 1.08
    tint = node(t, "ShaderNodeMix", (-150, 250))
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    link(t, base.outputs[0], tint.inputs["A"])
    link(t, var.outputs[0], tint.inputs["B"])
    st = node(t, "ShaderNodeMix", (100, 250))
    st.data_type = "RGBA"
    stf = node(t, "ShaderNodeMath", (-100, 50))
    stf.operation = "MULTIPLY"
    link(t, stitch.outputs[0], stf.inputs[0])
    stf.inputs[1].default_value = 0.5
    link(t, stf.outputs[0], st.inputs["Factor"])
    link(t, tint.outputs["Result"], st.inputs["A"])
    st.inputs["B"].default_value = hex_lin("#3a4152")
    cur = st.outputs["Result"]

    if logo and os.path.exists(LOGO):
        # projected through the chest along the body's facing axis: it follows
        # the fabric because it is sampled on the fabric surface itself
        img = node(t, "ShaderNodeTexImage", (-100, 600))
        img.image = bpy.data.images.load(LOGO, check_existing=True)
        img.extension = "CLIP"
        uv = attr("logo_u", 700)
        vv = attr("logo_v", 800)
        comb = node(t, "ShaderNodeCombineXYZ", (-300, 700))
        link(t, uv, comb.inputs["X"])
        link(t, vv, comb.inputs["Y"])
        link(t, comb.outputs[0], img.inputs["Vector"])
        lm = node(t, "ShaderNodeMath", (100, 700))
        lm.operation = "MULTIPLY"
        link(t, img.outputs["Alpha"], lm.inputs[0])
        link(t, attr("logo_m", 900), lm.inputs[1])
        lmix = node(t, "ShaderNodeMix", (350, 400))
        lmix.data_type = "RGBA"
        link(t, lm.outputs[0], lmix.inputs["Factor"])
        link(t, cur, lmix.inputs["A"])
        lmix.inputs["B"].default_value = hex_lin("#e9e9e6")
        cur = lmix.outputs["Result"]
        # the print is a slightly glossier, flatter layer over the knit
        pr = node(t, "ShaderNodeMix", (900, 200))
        pr.data_type = "FLOAT"
        link(t, lm.outputs[0], pr.inputs["Factor"])
        pr.inputs["A"].default_value = rough
        pr.inputs["B"].default_value = 0.45
        link(t, pr.outputs["Result"], bsdf.inputs["Roughness"])
    link(t, cur, bsdf.inputs["Base Color"])
    return mat


# ================================================================ helpers
def bone_t(co, bone):
    """Parameter along a bone (0 head, 1 tail) and distance from its axis."""
    h = np.array(bone_head(bone))
    tl = np.array(bone_head(bone, tail=True))
    ax = tl - h
    L = np.linalg.norm(ax)
    ax /= L
    t = (co - h) @ ax / L
    radial = np.linalg.norm((co - h) - np.outer((co - h) @ ax, ax), axis=1)
    return t, radial


def dominant(obj, names):
    w = np.stack([group_weights(obj, n) for n in names], axis=1)
    return w


def finish(obj, mat, thickness, col, subdiv=2):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    col.objects.link(obj)
    obj.parent = rig()
    arm = obj.modifiers.new("Armature", "ARMATURE")
    arm.object = rig()
    sol = obj.modifiers.new("Thickness", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = -1.0
    sol.use_even_offset = True
    sol.use_rim = True
    sub = obj.modifiers.new("Subdiv", "SUBSURF")
    sub.levels, sub.render_levels = 1, subdiv
    obj.matrix_parent_inverse = rig().matrix_world.inverted()


def seam_attrs(obj, co, edges, seam_masks):
    """seam_d = distance to the nearest seam line, seam_u = distance along it."""
    d_all = np.full(len(co), 1.0)
    u_all = np.zeros(len(co))
    for sd, region in seam_masks:
        d = np.where(region, np.abs(sd), 1.0)
        pick = d < d_all
        d_all[pick] = d[pick]
        # along-seam coordinate: arc length projected on the seam's own main axis
        pts = co[region & (np.abs(sd) < 0.004)]
        if len(pts) > 3:
            c = pts.mean(axis=0)
            _, _, vt = np.linalg.svd(pts - c)
            u = (co - c) @ vt[0]
            u_all[pick] = u[pick]
    set_point_attr(obj, "seam_d", d_all)
    set_point_attr(obj, "seam_u", u_all)
    return d_all


def groove(co, nrm, seam_d, depth=0.0007, width=0.0022):
    g = np.exp(-(seam_d / width) ** 2)
    ridge = np.exp(-((seam_d - width * 1.6) / (width * 0.7)) ** 2) * 0.4
    return co + nrm * ((ridge - g) * depth)[:, None]


# ================================================================ shirt
def shirt(bvh, col):
    src = body()
    co0 = rest_coords(src)
    neck = np.array(bone_head("neck_01"))
    pelvis = np.array(bone_head("pelvis"))
    spine1 = np.array(bone_head("spine_01"))

    hem_z = spine1[2] - 0.075
    w_arm_l = group_weights(src, "upperarm_l")
    w_arm_r = group_weights(src, "upperarm_r")
    w_low = sum(group_weights(src, g.name) for g in src.vertex_groups
                if g.name.startswith(("lowerarm", "hand", "thumb", "index", "middle",
                                      "ring", "pinky")))
    w_head = group_weights(src, "head")
    w_legs = group_weights(src, "thigh_l") + group_weights(src, "thigh_r")
    helpers = group_weights(src, "HelperGeometry") > 0.5

    # crew neck: dips ~3 cm lower at the front than the back
    rel = co0 - neck
    front = np.clip(-rel[:, 1] / 0.07, 0, 1)
    radial = np.linalg.norm(rel[:, :2], axis=1)
    neckline = neck[2] - 0.012 - 0.038 * front ** 1.5

    below_neck = (co0[:, 2] < neckline) | (radial > 0.105)

    tl, _ = bone_t(co0, "upperarm_l")
    tr, _ = bone_t(co0, "upperarm_r")
    sleeve_ok = np.where(w_arm_l > 0.3, tl < 0.62, True) & np.where(w_arm_r > 0.3, tr < 0.62, True)


    keep = (below_neck & (co0[:, 2] > hem_z - 0.04) & sleeve_ok & (w_low < 0.2) & (w_head < 0.2)
            & (w_legs < 0.6) & ~helpers)
    obj = rest_mesh_copy(src, "CB_Shirt")
    n0 = keep_only(obj, keep)
    subdivide(obj)          # original vertices keep indices 0..n0-1
    co, nrm, edges = arrays(obj)
    # clean openings: sleeves square to the arm at mid-bicep, hem level
    for side in ("l", "r"):
        h = np.array(bone_head(f"upperarm_{side}"))
        t = np.array(bone_head(f"upperarm_{side}", tail=True))
        arm = group_weights(obj, f"upperarm_{side}") > 0.2
        plane_cut(obj, h + (t - h) * (0.5 if TOP["kind"] == "tee" else 0.02), t - h, arm)
    co, nrm, edges = arrays(obj)
    plane_cut(obj, (0, 0, hem_z), (0, 0, -1), co[:, 2] < hem_z + 0.12)
    co, nrm, edges = arrays(obj)
    # the neckline and (for a vest) the armholes, finished with a few clean
    # plane cuts so the edge runs straight and smooth instead of stepping
    # round the mesh's vertices
    near_neck = np.linalg.norm(co[:, [0, 2]] - neck[[0, 2]], axis=1) < 0.25
    if TOP["kind"] == "tank":
        # the scoop front and back, each a clean box between the straps
        for pt, nv in (((0, neck[1] - 0.05, neck[2] - 0.12), (0, -0.28, 1)),
                       ((0, neck[1] + 0.05, neck[2] - 0.07), (0, 0.3, 1))):
            cut_box(obj, [(pt, nv), ((0.068, 0, 0), (-1, 0, 0)), ((-0.068, 0, 0), (1, 0, 0)),
                          ((0, neck[1], 0), (0, -1 if nv[1] < 0 else 1, 0))])
        cuts = []
    else:
        cuts = [((0, neck[1] - 0.05, neck[2] - 0.05), (0, -0.45, 1)),
                ((0, neck[1] + 0.05, neck[2] - 0.012), (0, 0.3, 1))]
    for pt, nv in cuts:
        # only the collar region, never the shoulders
        co, nrm, edges = arrays(obj)
        region = near_neck[:len(co)] if len(near_neck) == len(co) else (
            np.linalg.norm(co[:, [0, 2]] - neck[[0, 2]], axis=1) < 0.25)
        region &= np.abs(co[:, 0]) < (0.068 if TOP["kind"] == "tank" else 0.17)
        plane_cut(obj, pt, nv, region)
    if TOP["kind"] == "tank":
        # a vest is a tee with its sleeves and armholes cut away: the strap's
        # top is what's left of the crew neckline, so every edge is a clean cut
        for side, sx in (("l", 1), ("r", -1)):
            shp = np.array(bone_head(f"upperarm_{side}"))
            co, nrm, edges = arrays(obj)
            region = (co[:, 0] * sx > abs(shp[0]) * 0.55) & (co[:, 2] > shp[2] - 0.25)
            # the armhole: cut in from the shoulder, leaving a strap
            plane_cut(obj, (sx * (abs(shp[0]) - 0.045), shp[1], shp[2]), (sx * 1.0, 0, 0.25), region)
    co, nrm, edges = arrays(obj)
    edge_v = boundary_verts(obj)

    # ease: 2.5 mm on the chest and arms (compression fit), loosening toward the
    # hem where the shirt stands off the stomach, as in the photo
    hem_t = np.clip((spine1[2] + 0.16 - co[:, 2]) / 0.2, 0, 1)
    frontal = np.clip(-(co[:, 1] - spine1[1]) / 0.12, 0, 1)
    ease = 0.0028 + 0.012 * hem_t ** 1.6 * (0.5 + 0.5 * frontal)
    # bridge hollows first (more on the torso front, less on the arms), then ease
    arm_w = np.clip(group_weights(obj, "upperarm_l") + group_weights(obj, "upperarm_r"), 0, 1)
    co = laplacian(co, edges, 16, 0.5, weight=1.0 - 0.6 * arm_w, pinned=edge_v)
    put(obj, co)
    co, nrm, edges = arrays(obj)
    co = co + nrm * ease[:, None]
    put(obj, co)
    near_edge = geodesic(co, edges, edge_v) < 0.06
    push_outside(obj, bvh, 0.0022, only=near_edge)
    co, nrm, edges = arrays(obj)

    # folds -----------------------------------------------------------
    f = np.zeros(len(co))
    for i, p in enumerate(co):
        # soft horizontal stomach folds where the hem stands off the body
        f[i] += fbm(p * np.array([9, 9, 55]), 1.0, 2) * 0.0026 * hem_t[i] ** 1.2
        # tension lines radiating from the chest toward the armpits
        f[i] += fbm(p * np.array([30, 10, 30]), 1.0, 1) * 0.0003
    # sleeves hug the arm, so they gather in fine rings just above the hem
    for bone, w in (("upperarm_l", group_weights(obj, "upperarm_l")),
                    ("upperarm_r", group_weights(obj, "upperarm_r"))):
        t, _ = bone_t(co, bone)
        ring = np.exp(-((t - 0.44) / 0.07) ** 2) * (w > 0.3)
        f += np.sin(t * 190) * 0.0007 * ring
    co = co + nrm * np.maximum(f, -0.0012)[:, None]

    # seams -----------------------------------------------------------
    arm_l = np.array(bone_head("upperarm_l"))
    arm_r = np.array(bone_head("upperarm_r"))
    masks = []
    for arm, sx in ((arm_l, 1), (arm_r, -1)):
        collar_f = np.array([sx * 0.055, neck[1] - 0.075, neck[2] - 0.035])
        collar_b = np.array([sx * 0.06, neck[1] + 0.05, neck[2] - 0.005])
        pit_f = arm + np.array([-sx * 0.02, -0.06, -0.09])
        pit_b = arm + np.array([-sx * 0.02, 0.07, -0.09])
        top = arm + np.array([sx * 0.0, 0, 0.08])
        side = (co[:, 0] * sx) > 0.02
        masks.append((plane_dist(co, collar_f, pit_f, top), side & (co[:, 1] < neck[1] - 0.01)
                      & (co[:, 2] > pit_f[2])))
        masks.append((plane_dist(co, collar_b, pit_b, top), side & (co[:, 1] > neck[1] - 0.01)
                      & (co[:, 2] > pit_b[2])))
        # side seam runs down from the armpit
        masks.append((co[:, 1] - (arm[1] + 0.005), side & (co[:, 2] < arm[2] - 0.07)
                      & (np.abs(co[:, 0]) > abs(arm[0]) - 0.1)))
    sd = seam_attrs(obj, co, edges, masks)
    co = groove(co, nrm, sd)

    # collar rib and hem/cuff lines, from distance to each opening
    dist_edge = geodesic(co, edges, edge_v)
    neck_edge = edge_v[co[edge_v, 2] > neck[2] - 0.08]
    d_neck = geodesic(co, edges, neck_edge) if len(neck_edge) else np.full(len(co), 1.0)
    rib = (d_neck < 0.016).astype(float)
    set_point_attr(obj, "rib", rib)
    # a turned hem: the last 1.5 cm is double thickness and stitched
    hem_line = np.exp(-((dist_edge - 0.013) / 0.0012) ** 2) * (d_neck > 0.02)
    co = co + nrm * (0.0007 * (dist_edge < 0.013) + 0.0004 * rib)[:, None]
    set_point_attr(obj, "seam_d", np.minimum(sd, np.where(hem_line > 0.3, 0.0035, 1.0)))

    # logo: on his left chest (+X), centred over the pec, ~7 cm wide
    lc = np.array([0.07, 0, neck[2] - 0.115])
    size = 0.07
    lu = (co[:, 0] - lc[0]) / size + 0.5
    lv = (co[:, 2] - lc[2]) / size + 0.5
    lmask = ((co[:, 1] < neck[1] - 0.03) & (lu > 0) & (lu < 1) & (lv > 0) & (lv < 1)).astype(float)
    set_point_attr(obj, "logo_u", lu)
    set_point_attr(obj, "logo_v", lv)
    set_point_attr(obj, "logo_m", lmask)

    put(obj, co)
    mat = fabric_material("M_Shirt", SHIRT_HEX, knit_scale=900, sheen=0.06, rough=0.8, logo=TOP["logo"])
    finish(obj, mat, 0.0011, col)
    return obj, co, dist_edge


# ================================================================ pants
def pants(bvh, col):
    src = body()
    co0 = rest_coords(src)
    spine1 = np.array(bone_head("spine_01"))
    helpers = group_weights(src, "HelperGeometry") > 0.5
    waist_z = spine1[2] - 0.02
    ankle_l = np.array(bone_head("foot_l"))
    ankle_z = ankle_l[2] - 0.004
    kind = BOTTOM["kind"]
    if kind == "shorts":
        # training shorts end a hand above the knee
        ankle_z = np.array(bone_head("calf_l"))[2] + 0.1
    elif kind == "joggers":
        ankle_z = ankle_l[2] + 0.03          # a ribbed cuff just above the ankle bone
    w_foot = sum(group_weights(src, n) for n in ("foot_l", "foot_r", "ball_l", "ball_r"))
    w_upper = sum(group_weights(src, n) for n in ("spine_02", "spine_03", "upperarm_l",
                                                   "upperarm_r", "lowerarm_l", "lowerarm_r",
                                                   "hand_l", "hand_r"))
    w_hand = sum(group_weights(src, n) for n in ("hand_l", "hand_r", "lowerarm_l", "lowerarm_r"))
    w_leg = sum(group_weights(src, n) for n in ("pelvis", "spine_01", "thigh_l", "thigh_r",
                                                 "calf_l", "calf_r"))
    keep = ((co0[:, 2] < waist_z + 0.03) & (co0[:, 2] > ankle_z - 0.02) & (w_foot < 0.6)
            & (w_upper < 0.3) & (w_leg > 0.6) & ~helpers)
    obj = rest_mesh_copy(src, "CB_Pants")
    n0 = keep_only(obj, keep)
    subdivide(obj)
    co, nrm, edges = arrays(obj)
    plane_cut(obj, (0, 0, waist_z), (0, 0, 1), co[:, 2] > waist_z - 0.1)
    co, nrm, edges = arrays(obj)
    plane_cut(obj, (0, 0, ankle_z), (0, 0, -1), co[:, 2] < ankle_z + 0.1)
    co, nrm, edges = arrays(obj)

    knee_l, knee_r = np.array(bone_head("calf_l")), np.array(bone_head("calf_r"))
    knee_z = knee_l[2]
    # ease profile down the leg: roomy through the thigh and knee, tapered to a
    # gathered ankle — a tactical cut, not a skinny jean
    zt = (co[:, 2] - ankle_z) / (waist_z - ankle_z)          # 0 ankle, 1 waist
    ease = np.interp(zt, [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.93, 1.0],
                     [0.009, 0.014, 0.017, 0.018, 0.02, 0.019, 0.01, 0.005])
    # the cloth hangs forward off the shin and the front of the knee
    front = np.clip(-(co[:, 1] - np.array(bone_head("calf_l"))[1]) / 0.06, 0, 1)
    ease *= 1.0 + 0.25 * front * (zt < 0.6)
    # how each cut sits: leggings are second skin, joggers a relaxed taper,
    # shorts loose round the thigh
    ease *= {"cargo": 1.0, "leggings": 0.12, "joggers": 0.78, "shorts": 1.15}[kind]
    if kind == "leggings":
        ease += 0.0012
    if kind in ("cargo", "joggers", "shorts"):
        co = envelope_legs(co, zt)
    co = laplacian(co, edges, 20, 0.5, pinned=boundary_verts(obj))
    put(obj, co)
    co, nrm, edges = arrays(obj)
    co = co + nrm * ease[:, None]
    co = laplacian(co, edges, 6, 0.4, pinned=boundary_verts(obj))
    put(obj, co)
    pe_v = boundary_verts(obj)
    push_outside(obj, bvh, 0.003, only=geodesic(co, edges, pe_v) < 0.06)
    co, nrm, edges = arrays(obj)

    f = np.zeros(len(co))
    fold = {"cargo": 1.0, "leggings": 0.12, "joggers": 0.8, "shorts": 0.6}[kind]
    for i, p in enumerate(co):
        zz = zt[i]
        # vertical drape lines down the thigh and shin
        f[i] += fbm(p * np.array([30, 30, 3]), 1.0, 2) * 0.0035
        # horizontal folds behind and in front of the knee
        knee = math.exp(-((p[2] - knee_z) / 0.06) ** 2)
        f[i] += fbm(p * np.array([10, 10, 60]), 1.0, 2) * 0.0045 * knee
        # the fabric stacks where it gathers at the ankle
        stack = math.exp(-(zz / 0.1) ** 2)
        f[i] += math.sin(p[2] * 260 + fbm(p, 20.0, 1) * 3) * 0.0028 * stack
        # crotch and hip creases
        hip = math.exp(-((zz - 0.88) / 0.08) ** 2)
        f[i] += fbm(p * np.array([25, 25, 25]), 1.0, 2) * 0.0015 * hip
    co = co + nrm * (f * fold)[:, None]
    if kind == "joggers":
        # the ribbed cuff gathers the hem
        cuff = np.exp(-(zt / 0.035) ** 2)
        co = co - nrm * (cuff * 0.004)[:, None]

    # seams: outer side, inseam, and a front knee panel seam
    masks = []
    for kn, sx in ((knee_l, 1), (knee_r, -1)):
        side = co[:, 0] * sx > 0.01
        masks.append((co[:, 0] * sx - (abs(kn[0]) + 0.07 + 0.02 * zt), side & (zt < 0.97)))
        masks.append((co[:, 1] - kn[1] - 0.0, side & (co[:, 0] * sx < abs(kn[0])) & (zt < 0.8)))
        masks.append((co[:, 2] - (knee_z + 0.07), side & (co[:, 1] < kn[1] - 0.02)))
    sd = seam_attrs(obj, co, edges, masks)
    co = groove(co, nrm, sd, depth=0.0009)

    # waistband: a firm 4 cm band, a little proud of the fabric below it
    band = np.clip((co[:, 2] - (waist_z - 0.04)) / 0.004, 0, 1)
    co = co + nrm * (band * 0.0015)[:, None]
    set_point_attr(obj, "rib", np.zeros(len(co)))
    put(obj, co)

    knit = {"cargo": 520, "leggings": 1100, "joggers": 760, "shorts": 700}[kind]
    sheen = {"cargo": 0.04, "leggings": 0.3, "joggers": 0.18, "shorts": 0.12}[kind]
    rough = {"cargo": 0.86, "leggings": 0.55, "joggers": 0.9, "shorts": 0.75}[kind]
    mat = fabric_material("M_Pants", PANTS_HEX, knit_scale=knit, sheen=sheen, rough=rough)
    finish(obj, mat, 0.0013 if kind != "leggings" else 0.0008, col)
    if kind == "cargo":
        pocket(obj, co, nrm, knee_l, zt, mat, col)
    pc, _, pe = arrays(obj)
    dist = geodesic(pc, pe, boundary_verts(obj))
    return obj, pc, dist


def envelope_legs(co, zt):
    """Hang each trouser leg as a tube rather than a skin.

    Around each leg's axis, a vertex's radius is replaced by the largest radius
    found at the same angle within +-7 cm of height. That fills the dip between
    knee and calf and the hollow above the knee, the way fabric falls straight
    from the widest point. It fades out toward the crotch and hips, where the
    garment has to follow the pelvis.
    """
    co = co.copy()
    for side, sx in (("l", 1), ("r", -1)):
        hip = np.array(bone_head(f"thigh_{side}"))
        ankle = np.array(bone_head(f"foot_{side}"))
        sel = (co[:, 0] * sx > 0.0) & (zt < 0.9)
        idx = np.where(sel)[0]
        p = co[idx]
        # the leg axis, hip to ankle
        ax = ankle - hip
        L = np.linalg.norm(ax)
        ax /= L
        t = (p - hip) @ ax
        centre = hip + np.outer(t, ax)
        radial = p - centre
        r = np.linalg.norm(radial, axis=1)
        ref = np.cross(ax, [0, 1.0, 0])
        ref /= np.linalg.norm(ref)
        ref2 = np.cross(ax, ref)
        ang = np.arctan2(radial @ ref2, radial @ ref)
        zb = np.clip((t / 0.01).astype(int), 0, int(L / 0.01) + 1)
        ab = ((ang + np.pi) / (2 * np.pi) * 36).astype(int) % 36
        grid = np.zeros((zb.max() + 1, 36))
        np.maximum.at(grid, (zb, ab), r)
        # max over +-7 cm along the leg, then soften across angle and height
        win = 7
        env = np.zeros_like(grid)
        for z in range(grid.shape[0]):
            env[z] = grid[max(0, z - win):z + win + 1].max(axis=0)
        for _ in range(3):
            env = (np.roll(env, 1, 1) + env * 2 + np.roll(env, -1, 1)) / 4
            env[1:-1] = (env[:-2] + env[1:-1] * 2 + env[2:]) / 4
        new_r = np.maximum(r, env[zb, ab])
        # blend out at the top so the crotch and seat keep their shape
        blend = np.clip((0.86 - zt[idx]) / 0.12, 0, 1)
        r_final = r + (new_r - r) * blend
        co[idx] = centre + radial / (r[:, None] + 1e-9) * r_final[:, None]
    return co


def pocket(pants_obj, co, nrm, knee, zt, mat, col):
    """Cargo pocket on his left thigh: a bellowed box with a flap, as real panels."""
    me = pants_obj.data
    # outer thigh, between mid-thigh and just above the knee
    sx = 1
    outer = co[:, 0] * sx - abs(knee[0])
    front_back = co[:, 1] - knee[1]
    zc = knee[2] + 0.21
    in_patch = (outer > 0.03) & (np.abs(front_back) < 0.075) & (np.abs(co[:, 2] - zc) < 0.1)
    idx = np.where(in_patch)[0]
    if len(idx) < 20:
        print("POCKET skipped: patch too small", len(idx))
        return
    for name, z0, z1, lift, thick in (("CB_Pocket", zc - 0.1, zc + 0.07, 0.02, 0.0016),
                                      ("CB_PocketFlap", zc + 0.045, zc + 0.1, 0.026, 0.0018)):
        sel = in_patch & (co[:, 2] >= z0) & (co[:, 2] <= z1)
        obj = pants_obj.copy()
        obj.data = pants_obj.data.copy()
        obj.name = name
        obj.modifiers.clear()
        keep_only(obj, sel)
        pc, pn, pe = arrays(obj)
        # bellows: full in the middle, pinched at the stitched edges
        bv = boundary_verts(obj)
        d = geodesic(pc, pe, bv)
        puff = np.clip(d / 0.02, 0, 1) ** 0.7
        pc = pc + pn * (0.0025 + lift * 0.35 * puff)[:, None]
        # the flap droops a little over the pocket mouth
        if name == "CB_PocketFlap":
            low = np.clip((z0 + 0.02 - pc[:, 2]) / 0.02, 0, 1)
            pc = pc + pn * (0.003 * low)[:, None]
        set_point_attr(obj, "seam_d", np.clip(d - 0.004, 0, 1) + 0.0005)
        set_point_attr(obj, "seam_u", pc[:, 2] + pc[:, 1])
        set_point_attr(obj, "rib", np.zeros(len(pc)))
        put(obj, pc)
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        finish(obj, mat, thick, col)


# ================================================================ shoes
def shoes(bvh, col):
    """Low black trainers: an upper wrapped round each foot, and a real sole.

    Each upper starts as the convex hull of that foot — which already reads as
    a shoe's volume, with the toes and tendons gone — then is subdivided,
    relaxed, and grown a little so it clears the skin everywhere. The sole is
    its own slab from the upper's footprint, standing a little proud all round,
    which is what makes a shoe read as a shoe at a distance. Both ride the foot
    bone rigidly, as a stiff shoe does.
    """
    src = body()
    co0 = rest_coords(src)
    helpers = group_weights(src, "HelperGeometry") > 0.5
    w_foot = sum(group_weights(src, n) for n in ("foot_l", "foot_r", "ball_l", "ball_r"))
    upper_m = bpy.data.materials.new("M_ShoeUpper")
    upper_m.use_nodes = True
    b = upper_m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_lin(SHOE_HEX)
    b.inputs["Roughness"].default_value = 0.8
    b.inputs["Specular IOR Level"].default_value = 0.25
    sole_m = bpy.data.materials.new("M_ShoeSole")
    sole_m.use_nodes = True
    b = sole_m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_lin("#1c1c1d")
    b.inputs["Roughness"].default_value = 0.85
    made = []
    for side in ("l", "r"):
        ankle = np.array(bone_head(f"foot_{side}"))
        near = np.linalg.norm(co0[:, :2] - ankle[:2], axis=1) < 0.2
        foot = co0[(w_foot > 0.3) & near & (co0[:, 2] < ankle[2] + 0.03) & ~helpers]
        c = foot.mean(axis=0)
        grown = c + (foot - c) * np.array([1.12, 1.07, 1.1])
        bm = bmesh.new()
        for p in grown:
            bm.verts.new(p)
        bmesh.ops.convex_hull(bm, input=bm.verts[:])
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
        me = bpy.data.meshes.new(f"CB_Shoe_{side.upper()}")
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(f"CB_Shoe_{side.upper()}", me)
        co, nrm, edges = arrays(obj)
        co = laplacian(co, edges, 8, 0.5)
        co[:, 2] = np.maximum(co[:, 2], 0.024)          # sits on the sole
        put(obj, co)
        # the opening: nothing of the upper above the ankle
        plane_cut(obj, (0, 0, ankle[2] + 0.025), (0, 0, 1), np.ones(len(co), dtype=bool))
        obj.data.materials.append(upper_m)
        for p in obj.data.polygons:
            p.use_smooth = True
        col.objects.link(obj)
        sol = obj.modifiers.new("Thickness", "SOLIDIFY")
        sol.thickness, sol.offset = 0.003, -1
        sub = obj.modifiers.new("Subdiv", "SUBSURF")
        sub.levels, sub.render_levels = 1, 2
        made.append((obj, f"foot_{side}"))

        # sole from the footprint outline
        pts = co[co[:, 2] < 0.035][:, :2]
        cc = pts.mean(axis=0)
        ang = np.arctan2(pts[:, 1] - cc[1], pts[:, 0] - cc[0])
        ring = []
        for k in range(48):
            a0 = -np.pi + k * 2 * np.pi / 48
            m = (ang >= a0) & (ang < a0 + 2 * np.pi / 48)
            if m.any():
                far = pts[m][np.argmax(np.linalg.norm(pts[m] - cc, axis=1))]
                ring.append(cc + (far - cc) * 1.03)
        bm = bmesh.new()
        bottom = [bm.verts.new((x, y, 0.0)) for x, y in ring]
        top = [bm.verts.new((x, y, 0.028)) for x, y in ring]
        bm.faces.new(bottom[::-1])
        bm.faces.new(top)
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
        me = bpy.data.meshes.new(f"CB_Sole_{side.upper()}")
        bm.to_mesh(me)
        bm.free()
        so = bpy.data.objects.new(f"CB_Sole_{side.upper()}", me)
        so.data.materials.append(sole_m)
        col.objects.link(so)
        bev = so.modifiers.new("Bevel", "BEVEL")
        bev.width, bev.segments = 0.005, 3
        made.append((so, f"foot_{side}"))

    for o, bone in made:
        o.parent = rig()
        o.parent_type = "BONE"
        o.parent_bone = bone
        bpy.context.view_layer.update()
        o.matrix_parent_inverse = o.matrix_world.inverted() @ o.matrix_parent_inverse
    return made


# ================================================================ body cull
def hide_covered(garments):
    """Mask body skin that lies under cloth, so it can never poke through.

    A skin point is hidden only if a garment point sits directly over it —
    out along the skin's own normal, a few mm to ~2 cm away, and close to that
    line — and that garment point is well inside its panel (not at an edge).
    Anything the cloth merely passes near, like the top of the shoulder beside
    a vest's strap, stays visible.
    """
    from mathutils.kdtree import KDTree
    src = body()
    co = rest_coords(src)
    dg = bpy.context.evaluated_depsgraph_get()
    saved = [(m, m.show_viewport) for m in src.modifiers]
    for m, _ in saved:
        m.show_viewport = False
    dg.update()
    ev = src.evaluated_get(dg)
    nr = np.empty(len(ev.data.vertices) * 3)
    ev.data.vertices.foreach_get("normal", nr)
    for m, v in saved:
        m.show_viewport = v
    nr = nr.reshape(-1, 3)
    hide = np.zeros(len(co), dtype=bool)
    weight = np.zeros(len(co))
    for gco, dist_edge, margin in garments:
        kd = KDTree(len(gco))
        for i, p in enumerate(gco):
            kd.insert(p, i)
        kd.balance()
        for i, p in enumerate(co):
            for g, gi, d in kd.find_n(p, 4):
                if d > 0.03 or dist_edge[gi] <= margin:
                    continue
                v = np.array(g) - p
                along = v @ nr[i]
                lateral = np.linalg.norm(v - along * nr[i])
                if 0.0005 < along < 0.024 and lateral < 0.012:
                    hide[i] = True
                    weight[i] = max(weight[i], min(1.0, (dist_edge[gi] - margin) / 0.03))
                    break
    g = src.vertex_groups.get("covered") or src.vertex_groups.new(name="covered")
    for i in np.where(hide)[0]:
        g.add([int(i)], float(max(0.05, weight[i])), "REPLACE")
    # Tuck, don't cut: covered skin is drawn in under the cloth instead of
    # being deleted, so where the test is wrong you see a slight hollow at
    # worst, never a hole through the body.
    for mm in [m for m in src.modifiers if m.name == "Hide covered"]:
        src.modifiers.remove(mm)
    d = src.modifiers.get("Tuck covered") or src.modifiers.new("Tuck covered", "DISPLACE")
    d.direction = "NORMAL"
    d.mid_level = 0.0
    d.strength = -0.008
    d.vertex_group = "covered"
    src.modifiers.move(src.modifiers.find("Tuck covered"), src.modifiers.find("Armature") + 1)


def apply():
    col = collection("CLOTHING", collection("GAME_MESH"))
    bvh = body_bvh()
    s, s_co, s_dist = shirt(bvh, col)
    p, p_co, p_dist = pants(bvh, col)
    sh = shoes(bvh, col)
    hide_covered([(s_co, s_dist, 0.012), (p_co, p_dist, 0.012)])
    # the feet are entirely inside the shoes
    src = body()
    w_foot = sum(group_weights(src, n) for n in ("foot_l", "foot_r", "ball_l", "ball_r"))
    feet = np.where((w_foot > 0.5) & (rest_coords(src)[:, 2] < np.array(bone_head("foot_l"))[2]))[0]
    src.vertex_groups["covered"].add(feet.tolist(), 1.0, "REPLACE")
    print("CLOTHES", len(s.data.vertices), len(p.data.vertices))
