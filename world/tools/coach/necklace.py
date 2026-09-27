"""The necklace: a dark curb chain and a small cross, as real geometry.

The chain's path is found by casting rays in toward the neck from a loop that
sits high at the back and drops to the collar at the front, against the body
and the shirt together, so it rests on whatever is actually there. Links are
individual tori, alternating 90 degrees like a real curb chain, so it catches
light link by link and casts its own small shadows.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from common import bone_head, collection, hex_lin, rest_coords, rig, body

LINK = 0.0042          # link pitch
WIRE = 0.0009
DROP = 0.075           # how far below the back of the neck the front sits


def surface_bvh():
    objs = [body()] + [o for o in bpy.data.objects if o.name == "CB_Shirt"]
    verts, polys = [], []
    for o in objs:
        co = rest_coords(o) if o is body() else np.array([o.matrix_world @ v.co for v in o.data.vertices])
        base = len(verts)
        verts.extend(tuple(c) for c in co)
        polys.extend(tuple(base + i for i in p.vertices) for p in o.data.polygons)
    return BVHTree.FromPolygons(verts, polys)


def chain_path(bvh):
    neck = Vector(bone_head("neck_01"))
    pts = []
    n = 90
    for k in range(n):
        th = k / n * 2 * math.pi              # 0 = front (-Y)
        front = (1 + math.cos(th)) / 2       # 1 at the front, 0 at the back
        z = neck.z + 0.01 - DROP * front ** 2.2
        d = Vector((math.sin(th), -math.cos(th), 0))
        # a touch of asymmetry: the chain has slid a little to his right, as in the photo
        centre = Vector((neck.x - 0.004, neck.y - 0.008, z))
        origin = centre + d * 0.25
        hit = bvh.ray_cast(origin, -d, 0.3)
        if hit[0] is None:
            continue
        loc, nrm = hit[0], hit[1]
        pts.append(loc + nrm * (WIRE * 2.2))
    # relax the loop so it runs smoothly instead of copying every fold
    P = np.array(pts)
    for _ in range(6):
        P = (np.roll(P, 1, 0) + 2 * P + np.roll(P, -1, 0)) / 4
    return [Vector(p) for p in P]


def resample(loop, step):
    out = [loop[0]]
    acc = 0.0
    pts = loop + [loop[0]]
    for a, b in zip(pts, pts[1:]):
        seg = (b - a).length
        while acc + seg >= step:
            t = (step - acc) / seg
            a = a.lerp(b, t)
            out.append(a)
            seg = (b - a).length
            acc = 0.0
        acc += seg
    return out


def torus_link(bm, centre, tangent, normal, flip):
    """One elongated curb link, lying flat or edge-on alternately."""
    t = tangent.normalized()
    n = normal.normalized()
    if flip:
        n = t.cross(n).normalized()
    b = t.cross(n)
    R_major = (LINK * 0.62, LINK * 0.42)     # elongated along the chain
    seg, ring = 12, 6
    rings = []
    for i in range(seg):
        a = i / seg * 2 * math.pi
        c = centre + t * (math.cos(a) * R_major[0]) + b * (math.sin(a) * R_major[1])
        radial = (t * math.cos(a) * R_major[0] + b * math.sin(a) * R_major[1]).normalized()
        row = []
        for j in range(ring):
            q = j / ring * 2 * math.pi
            # flattened wire, as on a diamond-cut curb
            p = c + radial * (math.cos(q) * WIRE) + n * (math.sin(q) * WIRE * 0.7)
            row.append(bm.verts.new(p))
        rings.append(row)
    for i in range(seg):
        for j in range(ring):
            a, b2 = rings[i][j], rings[(i + 1) % seg][j]
            c2, d = rings[(i + 1) % seg][(j + 1) % ring], rings[i][(j + 1) % ring]
            bm.faces.new((a, b2, c2, d))


def cross_mesh(bm, origin, up, facing):
    """A Latin cross, 27 x 17 mm, 3 mm thick, with a bail loop at the top."""
    up = up.normalized()
    f = facing.normalized()
    right = up.cross(f).normalized()
    f = right.cross(up).normalized()
    th = 0.003
    bars = [(-0.0028, 0.0028, -0.027, 0.0), (-0.0085, 0.0085, -0.0095, -0.0045)]
    for x0, x1, y0, y1 in bars:
        corners = []
        for z in (0, th):
            for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
                corners.append(bm.verts.new(origin + right * x + up * y + f * z))
        a, b = corners[:4], corners[4:]
        bm.faces.new(a[::-1])
        bm.faces.new(b)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))


def metal(name, hex_col, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_lin(hex_col)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = rough
    # fine scratches and wear break up the reflection
    tc = t.nodes.new("ShaderNodeTexCoord")
    sc = t.nodes.new("ShaderNodeTexNoise")
    sc.inputs["Scale"].default_value = 3000
    sc.inputs["Detail"].default_value = 2
    mp = t.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1, 1, 30)
    t.links.new(tc.outputs["Object"], mp.inputs[0])
    t.links.new(mp.outputs[0], sc.inputs[0])
    rr = t.nodes.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value = rough * 0.7
    rr.inputs["To Max"].default_value = rough * 1.5
    t.links.new(sc.outputs["Fac"], rr.inputs["Value"])
    t.links.new(rr.outputs[0], b.inputs["Roughness"])
    return m


def attach(obj, bone):
    obj.parent = rig()
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_parent_inverse = obj.matrix_world.inverted() @ obj.matrix_parent_inverse


def apply():
    col = collection("ACCESSORIES", collection("GAME_MESH"))
    bvh = surface_bvh()
    loop = chain_path(bvh)
    if len(loop) < 20:
        print("NECKLACE: path not found", len(loop))
        return
    links = resample(loop, LINK)
    neck = Vector(bone_head("neck_01"))

    bm = bmesh.new()
    for i, p in enumerate(links):
        t = links[(i + 1) % len(links)] - links[i - 1]
        # the surface normal: out from the neck axis, tipped by the slope
        out = (p - Vector((neck.x, neck.y, p.z))).normalized()
        torus_link(bm, p, t, out, i % 2 == 1)
    me = bpy.data.meshes.new("CB_Necklace")
    bm.to_mesh(me)
    bm.free()
    chain = bpy.data.objects.new("CB_Necklace", me)
    for p in chain.data.polygons:
        p.use_smooth = True
    chain.data.materials.append(metal("M_ChainBlack", "#1e1e22", 0.28))
    col.objects.link(chain)
    attach(chain, "spine_03")

    # the pendant hangs from the lowest point of the chain, lying on the shirt
    low = min(links, key=lambda v: v.z)
    hit = bvh.ray_cast(low + Vector((0, -0.2, -0.012)), Vector((0, 1, 0)), 0.4)
    facing = Vector((0, -1, 0)) if hit[0] is None else hit[1]
    origin = low + Vector((0, 0, -0.004))
    if hit[0] is not None:
        origin = Vector((low.x + 0.001, hit[0].y - 0.0032, low.z - 0.004))
    up = Vector((0.08, 0, 1))        # hanging a few degrees off plumb
    bm = bmesh.new()
    cross_mesh(bm, origin, up, facing)
    me = bpy.data.meshes.new("CB_Cross")
    bm.to_mesh(me)
    bm.free()
    cross = bpy.data.objects.new("CB_Cross", me)
    cross.data.materials.append(metal("M_CrossBlack", "#18181b", 0.22))
    bev = cross.modifiers.new("Bevel", "BEVEL")
    bev.width, bev.segments = 0.0006, 2
    col.objects.link(cross)
    attach(cross, "spine_03")
    print("NECKLACE links", len(links), "cross at", tuple(round(c, 3) for c in origin))
