"""Sea life for the lake, modelled rather than assembled from primitives.

    blender -b --factory-startup -P tools/sealife/build.py -- raw/sealife.glb

Every creature is lofted from cross-sections along its length (the way a
boat hull or the car's shell is), subdivided smooth, and painted with vertex
colours: countershading dark above and pale below, and each species' own
markings. The game drives the animation (tail beat, flipper strokes, wing
flaps, the bell's pulse) in shaders or by rotating named parts, so nothing
here is rigged.

Axes (glTF, after export): +Z is forward (the head), +Y up, +X the animal's
left. One metre long for the fish, real sizes for the rest.

  Fish_Silver, Fish_Tang, Fish_Clown    a body with its fins, one mesh each
  Turtle                                shell, plastron, head, tail
    Flipper_FL/FR/BL/BR                 each with its origin at the shoulder
  Ray                                   one mesh: disc, cephalic fins, tail
  Jelly_Bell, Jelly_Arms, Jelly_Tentacles
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])

bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.data.collections.new("SEALIFE")
bpy.context.scene.collection.children.link(col)


def srgb(h):
    """A hex colour as the linear value Blender and glTF store."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def finish(obj, subd=1):
    """Smooth shading, a subdivision applied, colour layer kept."""
    for p in obj.data.polygons:
        p.use_smooth = True
    if subd:
        m = obj.modifiers.new("sub", "SUBSURF")
        m.levels = m.render_levels = subd
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier="sub")
        obj.select_set(False)
    return obj


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    return o


def paint(obj, fn):
    """Vertex colour from a function of the vertex's position (and normal)."""
    me = obj.data
    if "Col" not in me.color_attributes:
        me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr = me.color_attributes["Col"]
    for v in me.vertices:
        attr.data[v.index].color = fn(v.co, v.normal)


# Blender axes while building: +Y forward (head), +Z up, +X left.
# The glTF exporter turns Blender +Y into -Z, so each finished object is
# rotated 180 degrees about Z to come out with the head on +Z.

def loft(name, stations, rings=16):
    """A closed body from (y, half_width, half_height, centre_z) stations."""
    bm = bmesh.new()
    loops = []
    for (y, w, h, cz) in stations:
        ring = []
        for k in range(rings):
            a = (k / rings) * math.pi * 2
            # a rounded-rectangle-ish section, fuller at the flanks
            c, s = math.cos(a), math.sin(a)
            x = w * math.copysign(abs(c) ** 0.85, c)
            z = cz + h * math.copysign(abs(s) ** 0.9, s)
            ring.append(bm.verts.new((x, y, z)))
        loops.append(ring)
    for i in range(len(loops) - 1):
        a, b = loops[i], loops[i + 1]
        for k in range(rings):
            bm.faces.new((a[k], a[(k + 1) % rings], b[(k + 1) % rings], b[k]))
    # caps
    for ring, rev in ((loops[0], True), (loops[-1], False)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
        for k in range(rings):
            f = (ring[k], ring[(k + 1) % rings], c)
            bm.faces.new(f[::-1] if rev else f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm)


def fin(name, outline, thick=0.012):
    """A thin fin from a 2D outline in the (y, z) plane at x = 0, with a little thickness."""
    bm = bmesh.new()
    front = [bm.verts.new((thick / 2, y, z)) for y, z in outline]
    back = [bm.verts.new((-thick / 2, y, z)) for y, z in outline]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm)


def side_fin(name, root, outline, side, tilt=0.5, thick=0.01):
    """A paired fin (pectoral, pelvic) lying out from the body at `root`."""
    bm = bmesh.new()
    top = [bm.verts.new((root[0] + side * u, root[1] + v, root[2] - side * u * tilt * 0.3 + thick / 2)) for u, v in outline]
    bot = [bm.verts.new((root[0] + side * u, root[1] + v, root[2] - side * u * tilt * 0.3 - thick / 2)) for u, v in outline]
    bm.faces.new(top)
    bm.faces.new(bot[::-1])
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm)


def eye(name, pos, r):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
    for v in bm.verts:
        v.co += Vector(pos)
    return mesh_obj(name, bm)


def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def face_forward(obj):
    obj.rotation_euler[2] = math.pi
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(rotation=True)
    obj.select_set(False)


# ---------------------------------------------------------------- fish
def fish(name, depth, colour_fn, stations=None):
    """A reef fish one metre long: head at +y 0.5, tail fork at -y 0.5."""
    def prof_at(t):
        return math.sin(math.pi * (0.12 + 0.88 * t) ** 0.8)
    if stations is None:
        stations = []
        for i in range(14):
            t = i / 13                          # 0 tail peduncle .. 1 snout
            y = -0.33 + t * 0.81
            # deepest a third back from the snout, pinching to the peduncle
            prof = prof_at(t)
            h = max(0.025, depth * prof)
            w = max(0.02, 0.12 * prof * (0.55 + 0.45 * t))
            stations.append((y, w, h, 0.0))
    # the eye sits on the flank, set into the head, not out in the water
    te = (0.34 + 0.33) / 0.81
    ew = max(0.02, 0.12 * prof_at(te) * (0.55 + 0.45 * te))
    eh = depth * prof_at(te)
    body = finish(loft(f"{name}_body", stations, 18), 1)
    # forked tail
    tail = fin(f"{name}_tail", [(-0.3, 0.0), (-0.46, depth * 0.95), (-0.5, depth * 0.9), (-0.41, 0.0),
                                (-0.5, -depth * 0.9), (-0.46, -depth * 0.95)])
    # long dorsal and anal fins
    dorsal = fin(f"{name}_dorsal", [(0.18, depth * 0.95), (0.08, depth * 1.28), (-0.12, depth * 1.2),
                                    (-0.27, depth * 0.72), (-0.22, depth * 0.55), (0.12, depth * 0.8)])
    anal = fin(f"{name}_anal", [(0.0, -depth * 0.85), (-0.1, -depth * 1.12), (-0.25, -depth * 0.8),
                                (-0.22, -depth * 0.55), (-0.02, -depth * 0.7)])
    pect = [side_fin(f"{name}_pec{s}", (0.1 * s, 0.22, -depth * 0.2), [(0, 0), (0.12, -0.06), (0.16, -0.14), (0.05, -0.12)], s)
            for s in (1, -1)]
    eyes = [eye(f"{name}_eye{s}", (s * (ew * 0.92), 0.34, eh * 0.28), min(0.032, eh * 0.28)) for s in (1, -1)]
    parts = [body, tail, dorsal, anal] + pect
    for p in parts:
        paint(p, colour_fn)
    for e in eyes:
        paint(e, lambda co, n: srgb("#0b0b0d") if co.y > 0.4 or abs(co.x) > 0.1 else srgb("#e8d9a8"))
    o = join(name, parts + eyes)
    face_forward(o)
    return o


def silver(co, n):
    up = smooth((co.z + 0.1) / 0.3)
    c = lerp(srgb("#e9eef0"), srgb("#4f6b7c"), up)
    # a faint lateral line and scale shimmer
    if abs(co.z) < 0.012:
        c = lerp(c, srgb("#2d3e48"), 0.5)
    sh = 0.9 + 0.1 * noise.noise(co * 40)
    return tuple(x * sh for x in c[:3]) + (1.0,)


def tang(co, n):
    c = srgb("#1c53c9")
    # the black palette mark along the flank and the yellow tail
    if co.y < -0.3:
        return srgb("#f1c22c")
    band = abs(co.z - 0.06 - 0.25 * (co.y + 0.1)) < 0.035 + 0.02 * math.sin(co.y * 12)
    if -0.25 < co.y < 0.3 and band:
        return srgb("#0d0f1c")
    return c


def clown(co, n):
    c = srgb("#f06a12")
    # three white bars edged in black
    for yc, wdt in ((0.3, 0.035), (0.03, 0.045), (-0.3, 0.03)):
        d = abs(co.y - yc)
        if d < wdt:
            return srgb("#f8f6ef")
        if d < wdt + 0.012:
            return srgb("#141212")
    if co.y < -0.43:
        return srgb("#141212")
    return c


# ---------------------------------------------------------------- turtle
def turtle():
    L = 0.9
    # the carapace: a low dome, lofted fore to aft
    st = []
    for i in range(12):
        t = i / 11
        y = -L / 2 + t * L
        prof = math.sin(math.pi * (0.04 + 0.92 * t)) ** 0.6
        st.append((y, 0.36 * prof + 0.02, 0.105 * prof + 0.012, 0.06))
    shell = finish(loft("Shell", st, 24), 1)
    # scutes: the plates, as a darker web of grooves painted into the shell
    def scutes(co, n):
        base = lerp(srgb("#6b5530"), srgb("#8a7038"), 0.5 + 0.5 * noise.noise(co * 6))
        if co.z < 0.05:
            return srgb("#d7c79a")          # plastron
        cell = noise.cell(Vector((co.x * 5.5, co.y * 5.0, 0)))
        edge = abs(noise.noise(Vector((co.x * 5.5, co.y * 5.0, 0.3)))) < 0.06
        if edge:
            return srgb("#3a2c17")
        return lerp(base, srgb("#b08a44"), cell * 0.35)
    paint(shell, scutes)
    head = finish(loft("Head", [(0.42, 0.05, 0.045, 0.05), (0.5, 0.075, 0.06, 0.06), (0.6, 0.07, 0.055, 0.065),
                                 (0.68, 0.04, 0.035, 0.055)], 12), 1)
    paint(head, lambda co, n: srgb("#5f6b45") if co.z > 0.05 else srgb("#b7b48c"))
    eyes = [eye(f"TEye{s}", (0.055 * s, 0.61, 0.085), 0.013) for s in (1, -1)]
    for e in eyes:
        paint(e, lambda co, n: srgb("#101010"))
    tail = finish(loft("Tail", [(-0.46, 0.035, 0.02, 0.05), (-0.56, 0.012, 0.01, 0.04)], 8), 0)
    paint(tail, lambda co, n: srgb("#5f6b45"))
    body = join("Turtle", [shell, head, tail] + eyes)
    face_forward(body)
    # flippers: flat, tapering paddles, origin at the shoulder
    for key, (x, y, length, width) in {
        "FL": (0.3, 0.22, 0.55, 0.16), "FR": (-0.3, 0.22, 0.55, 0.16),
        "BL": (0.24, -0.3, 0.26, 0.12), "BR": (-0.24, -0.3, 0.26, 0.12),
    }.items():
        # built already facing the way the body faces after its flip: the
        # shoulder mirrored, reaching outwards, swept back
        s = -1 if x > 0 else 1
        outline = [(0, -0.03), (length * 0.4, -width * 0.5 - length * 0.2), (length, -width * 0.1 - length * 0.35),
                   (length * 0.9, width * 0.2 - length * 0.3), (length * 0.3, width * 0.45), (0, 0.03)]
        f = side_fin(f"Flipper_{key}", (0, 0, 0), outline, s, tilt=0.2, thick=0.03)
        paint(f, lambda co, n: srgb("#5a6841") if n.z > 0 else srgb("#aeb28a"))
        finish(f, 1)
        # the game turns this about its origin, which is the shoulder
        f.parent = body
        f.location = (-x, -y, 0.06)


# ---------------------------------------------------------------- ray
def ray():
    # a diamond disc with thickness: lofted along the body, very wide, thin
    st = []
    for i in range(16):
        t = i / 15
        y = -0.55 + t * 1.1
        span = 0.95 * math.sin(math.pi * (0.06 + 0.88 * t)) ** 1.15 * (1.0 if t > 0.4 else 0.6 + t)
        thick = 0.07 * math.sin(math.pi * t) ** 0.7 + 0.01
        st.append((y, span, thick, 0.0))
    disc = finish(loft("RayDisc", st, 20), 1)
    # thin the wings towards the tips: squash z by distance from the centreline
    for v in disc.data.vertices:
        v.co.z *= max(0.18, 1.0 - abs(v.co.x) / 1.05)
    cep = [finish(loft(f"Cep{s}", [(0.5, 0.03, 0.02, 0.0), (0.66, 0.02, 0.015, -0.01)], 8), 0) for s in (1, -1)]
    for s, c in zip((1, -1), cep):
        for v in c.data.vertices:
            v.co.x += 0.16 * s
    tail = finish(loft("RayTail", [(-0.5, 0.03, 0.02, 0.0), (-1.3, 0.006, 0.005, 0.0)], 6), 0)
    parts = [disc, tail] + cep
    for p in parts:
        paint(p, lambda co, n: lerp(srgb("#e9ecec"), srgb("#39434d"), smooth((n.z + 0.2) / 0.6)))
    o = join("Ray", parts)
    face_forward(o)


# ---------------------------------------------------------------- jellyfish
def jellyfish():
    # the bell: a lathe of a domed profile with a scalloped rim
    bm = bmesh.new()
    segs, rows = 32, 10
    rings = []
    for r in range(rows + 1):
        t = r / rows
        ang = t * math.pi * 0.52
        rad = 0.3 * math.sin(ang) + 0.01
        z = 0.22 * math.cos(ang)
        ring = []
        for k in range(segs):
            a = (k / segs) * math.pi * 2
            sc = 1.0 + (0.08 * math.cos(a * 8) if r == rows else 0)
            ring.append(bm.verts.new((math.cos(a) * rad * sc, math.sin(a) * rad * sc, z - (0.03 * max(0, math.cos(a * 8)) if r == rows else 0))))
        rings.append(ring)
    for r in range(rows):
        for k in range(segs):
            bm.faces.new((rings[r][k], rings[r][(k + 1) % segs], rings[r + 1][(k + 1) % segs], rings[r + 1][k]))
    bell = finish(mesh_obj("Jelly_Bell", bm), 1)
    paint(bell, lambda co, n: lerp(srgb("#f7d6ef"), srgb("#d57bbf"), smooth(1 - co.z / 0.22)))
    # frilled oral arms: four twisted ribbons hanging from the middle
    bm = bmesh.new()
    for arm in range(4):
        a0 = arm * math.pi / 2
        prev = None
        for i in range(14):
            t = i / 13
            z = -t * 0.7
            tw = a0 + t * 2.2
            half = 0.05 * (1 - t * 0.6) * (1 + 0.3 * math.sin(t * 18))
            cx, cy = math.cos(a0) * 0.05, math.sin(a0) * 0.05
            v1 = bm.verts.new((cx + math.cos(tw) * half, cy + math.sin(tw) * half, z))
            v2 = bm.verts.new((cx - math.cos(tw) * half, cy - math.sin(tw) * half, z))
            if prev:
                bm.faces.new((prev[0], prev[1], v2, v1))
            prev = (v1, v2)
    arms = mesh_obj("Jelly_Arms", bm)
    paint(arms, lambda co, n: srgb("#f0b3dd"))
    # tentacles: fine threads round the rim
    bm = bmesh.new()
    for k in range(16):
        a = (k / 16) * math.pi * 2
        x, y = math.cos(a) * 0.27, math.sin(a) * 0.27
        ln = 0.9 + 0.3 * math.sin(k * 1.7)
        bmesh.ops.create_cone(bm, cap_ends=False, segments=4, radius1=0.006, radius2=0.002, depth=ln,
                              matrix=__import__("mathutils").Matrix.Translation((x, y, -ln / 2 + 0.02)))
    tent = mesh_obj("Jelly_Tentacles", bm)
    paint(tent, lambda co, n: srgb("#fbe3f4"))
    for o in (bell, arms, tent):
        # up is +Z in Blender, +Y in glTF: no flip needed for a jellyfish
        pass


fish("Fish_Silver", 0.2, silver)
fish("Fish_Tang", 0.34, tang)
fish("Fish_Clown", 0.24, clown)
turtle()
ray()
jellyfish()

# spread them out so the file is easy to look at; the game re-places them
for i, name in enumerate(["Fish_Silver", "Fish_Tang", "Fish_Clown"]):
    bpy.data.objects[name].location = (i * 1.3 - 1.3, 0, 0)
bpy.data.objects["Turtle"].location = (0, 0, 1.0)
bpy.data.objects["Ray"].location = (0, 0, 2.2)
for n in ("Jelly_Bell", "Jelly_Arms", "Jelly_Tentacles"):
    bpy.data.objects[n].location = (2.4, 0, 1.2)

# one plain material that shows the vertex colours
m = bpy.data.materials.new("Sealife")
m.use_nodes = True
t = m.node_tree
vc = t.nodes.new("ShaderNodeVertexColor")
vc.layer_name = "Col"
t.links.new(vc.outputs["Color"], t.nodes["Principled BSDF"].inputs["Base Color"])
t.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
for o in col.all_objects:
    if o.type == "MESH":
        o.data.materials.clear()
        o.data.materials.append(m)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True,
                          export_attributes=False, export_vertex_color="ACTIVE")
print("WROTE", OUT, [o.name for o in col.all_objects])
