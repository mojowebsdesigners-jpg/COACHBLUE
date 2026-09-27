"""Auto-rig a Hyper3D A-pose character onto the Mixamo skeleton from three.js's Xbot.

    blender -b --factory-startup -P tools/rig.py -- <character.glb> <Xbot.glb> <out.glb> [preview_dir]

1. Normalise the mesh (feet on 0, centred, 1.80 m tall).
2. Measure landmarks straight off the vertices (crotch, neck, shoulders, arm axis).
3. Move Xbot's joints onto those landmarks, keeping every bone's orientation so the
   Mixamo clips still apply, except the arm chain, which is rotated down to the A-pose.
4. Bind with automatic weights, pose the arms back up to horizontal, bake that into
   the mesh and apply the pose as rest -> a T-pose skin on the original T-pose rig.
5. Keep idle/walk/run/agree/headShake, shrink textures, export GLB.
"""
import bpy, bmesh, sys, math, os
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, XBOT, OUT = argv[0], argv[1], argv[2]
PREVIEW = argv[3] if len(argv) > 3 else None
# each character keeps its own stature: normalising everyone to the same
# height would throw away the only thing that makes them different people
HEIGHT = float(os.environ.get("RIG_HEIGHT", "1.80"))
KEEP = {"idle", "walk", "run", "agree", "headShake"}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def world_verts(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = np.array(obj.matrix_world)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ev.to_mesh_clear()
    return co @ mw[:3, :3].T + mw[:3, 3]


def clusters_1d(xs, gap):
    xs = np.sort(xs)
    if len(xs) == 0:
        return []
    cuts = np.where(np.diff(xs) > gap)[0]
    starts = np.r_[0, cuts + 1]; ends = np.r_[cuts, len(xs) - 1]
    return [(xs[s], xs[e]) for s, e in zip(starts, ends)]


def slab(v, z, h=0.012):
    return v[np.abs(v[:, 2] - z) < h]


def crotch_z(v, H):
    """Lowest height where the two legs have merged into one body."""
    for z in np.arange(0.30 * H, 0.65 * H, 0.004):
        s = slab(v, z); s = s[np.abs(s[:, 0]) < 0.14 * H]
        cl = clusters_1d(s[:, 0], 0.012)
        if any(a <= 0 <= b for a, b in cl):
            return z
    return 0.5 * H


def neck_z(v, H):
    best, bz = 1e9, 0.85 * H
    for z in np.arange(0.79 * H, 0.875 * H, 0.003):
        s = slab(v, z, 0.006); s = s[np.abs(s[:, 0]) < 0.12 * H]
        cl = [c for c in clusters_1d(s[:, 0], 0.01) if c[0] <= 0 <= c[1]]
        if cl:
            w = cl[0][1] - cl[0][0]
            if w < best:
                best, bz = w, z
    return bz


# ---------------------------------------------------------------- character
bpy.ops.import_scene.gltf(filepath=SRC)
char_objs = [o for o in scene.objects if o.type == "MESH"]
# MakeHuman ships its morph targets as shape keys. They block every modifier
# from here on, and because the mix is evaluated at render time they also hide
# the real geometry from the landmark measuring below. Bake and drop them.
for o in char_objs:
    if not o.data.shape_keys:
        continue
    # the operator form of this needs a UI context, which -b does not have, so
    # read the evaluated (mixed) vertices and write them back over the base
    dg = bpy.context.evaluated_depsgraph_get()
    mixed = [v.co.copy() for v in o.evaluated_get(dg).data.vertices]
    n = len(o.data.shape_keys.key_blocks)
    for kb in list(o.data.shape_keys.key_blocks):
        o.shape_key_remove(kb)
    for i, co in enumerate(mixed):
        o.data.vertices[i].co = co
    o.data.update()
    print("BAKED SHAPE KEYS", o.name, n)
bpy.ops.object.select_all(action="DESELECT")
for o in char_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = char_objs[0]
if len(char_objs) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "CoachBody"
# drop importer's empty parents but keep the world transform
for o in list(scene.objects):
    if o.type == "EMPTY":
        for ch in o.children:
            mw = ch.matrix_world.copy(); ch.parent = None; ch.matrix_world = mw
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
v = world_verts(body)
mn, mx = v.min(0), v.max(0)
s = HEIGHT / (mx[2] - mn[2])
body.data.transform(Matrix.Translation((0, 0, 0)) @ Matrix.Scale(s, 4) @
                    Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))))
body.data.update()
v = world_verts(body)
H = v[:, 2].max()

# merge by distance so auto-weights sees one connected surface
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
bm.to_mesh(body.data); bm.free()

cz = crotch_z(v, H)
nz = neck_z(v, H)
# shoulder: widest point of the torso+deltoid just under the neck, arms excluded by gap
sh_s = slab(v, nz - 0.07 * H, 0.01)
cl = [c for c in clusters_1d(sh_s[:, 0], 0.015) if c[0] <= 0 <= c[1]]
delt_half = (cl[0][1] - cl[0][0]) / 2 if cl else 0.2 * H * 0.5
sh_x = 0.62 * delt_half
sh_z = nz - 0.055 * H

# arm axis: PCA over left-side vertices outside the deltoid, above the crotch
shoulder = np.array([sh_x, 0.0, sh_z])
arm = v[(v[:, 0] > sh_x + 0.10) & (v[:, 2] > cz + 0.05)]
rel = arm - shoulder
dist = np.hypot(rel[:, 0], rel[:, 2])
band = rel[(dist > 0.12) & (dist < 0.30)]
d = band.mean(0); d[1] = 0; d /= np.linalg.norm(d)
arm_angle = math.atan2(-d[2], d[0])        # radians below horizontal
proj = rel @ d
arm_len = proj.max()
print(f"LANDMARKS H={H:.3f} crotch={cz:.3f} neck={nz:.3f} shoulder=({sh_x:.3f},{sh_z:.3f}) "
      f"arm_angle={math.degrees(arm_angle):.1f} arm_len={arm_len:.3f}")


def cluster_center(z, side):
    ss = slab(v, z, 0.01)
    ss = ss[(ss[:, 0] * side > 0.01) & (np.abs(ss[:, 0]) < 0.12 * H)]
    if len(ss) == 0:
        return np.array([side * 0.09, 0, z])
    return np.array([ss[:, 0].mean(), ss[:, 1].mean(), z])


def depth_center(z):
    ss = slab(v, z, 0.01); ss = ss[np.abs(ss[:, 0]) < 0.08]
    return ss[:, 1].mean() if len(ss) else 0.0


# ---------------------------------------------------------------- Xbot rig
before = set(scene.objects)
bpy.ops.import_scene.gltf(filepath=XBOT)
imported = [o for o in scene.objects if o not in before]
rig = [o for o in imported if o.type == "ARMATURE"][0]
xb_mesh = [o for o in imported if o.type == "MESH" and "Surface" in o.name][0]
# the importer stacks every clip as an NLA track; left in place they all blend together
if rig.animation_data:
    for tr in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(tr)
    rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix()
rig.data.pose_position = "REST"
bpy.context.view_layer.update()
xv = world_verts(xb_mesh)
xH = xv[:, 2].max()
xcz = crotch_z(xv, xH)
xnz = neck_z(xv, xH)
for o in imported:
    if o.type == "MESH":
        bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    base = a.name.replace("_Armature", "")
    if base not in KEEP:
        bpy.data.actions.remove(a)
    else:
        a.name = base; a.use_fake_user = True

mw = rig.matrix_world.copy(); mwi = mw.inverted()
bones_w = {b.name: (mw @ b.head_local.copy(), mw @ b.tail_local.copy()) for b in rig.data.bones}
X = lambda n: np.array(bones_w["mixamorig:" + n][0])
print(f"XBOT H={xH:.3f} crotch={xcz:.3f} neck={xnz:.3f}")

# vertical piecewise maps (leg / torso / head)
x_hip, x_neck = X("Hips")[2], X("Neck")[2]
leg_s = cz / xcz
tor_s = (nz - cz) / (xnz - xcz)
head_s = (H - nz) / (xH - xnz)
x_up = X("LeftUpLeg"); x_knee = X("LeftLeg"); x_ank = X("LeftFoot")


def map_z(z):
    if z <= xcz:
        return z * leg_s
    if z <= xnz:
        return cz + (z - xcz) * tor_s
    return nz + (z - xnz) * head_s


targets = {}
for name, (hw, tw) in bones_w.items():
    short = name.replace("mixamorig:", "")
    p = np.array(hw)
    side = 1 if "Left" in short else (-1 if "Right" in short else 0)
    if any(k in short for k in ("UpLeg", "Leg", "Foot", "Toe")):
        c = cluster_center(map_z(p[2]) if p[2] > 0.12 else 0.12 * leg_s, side)
        q = np.array([c[0] + (p[0] - side * abs(x_ank[0])) * 0.6, p[1] * leg_s + c[1], map_z(p[2])])
    elif any(k in short for k in ("Shoulder", "Arm", "Hand")):
        # arm chain handled below
        continue
    else:
        z = map_z(p[2])
        q = np.array([0.0, depth_center(z) + p[1] * 0.3, z])
    targets[name] = q

# arm chains: distances along Xbot's horizontal arm, scaled, then rotated to the A-pose
x_sh = X("LeftArm"); x_tip = max(bones_w.items(), key=lambda kv: kv[1][0].x)[1][0]
x_arm_len = x_tip.x - x_sh[0] + 0.03
arm_s = arm_len / x_arm_len
R_left = Matrix.Rotation(arm_angle, 4, "Y")     # +X arm swings down
for name, (hw, tw) in bones_w.items():
    short = name.replace("mixamorig:", "")
    if not any(k in short for k in ("Shoulder", "Arm", "Hand")):
        continue
    side = 1 if "Left" in short else -1
    p = np.array(hw)
    local = Vector(((abs(p[0]) - x_sh[0]) * arm_s, (p[1] - x_sh[1]) * arm_s, (p[2] - x_sh[2]) * arm_s))
    if "Shoulder" in short and "Arm" not in short:
        q = np.array([side * sh_x * 0.35, depth_center(sh_z), sh_z + 0.004])
    else:
        r = R_left @ local
        q = np.array([side * (sh_x + r.x), depth_center(sh_z) + r.y, sh_z + r.z])
    targets[name] = q

# write edit bones: new head, same orientation (arms rotated), length scaled
bpy.ops.object.select_all(action="DESELECT"); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
orig_rot = {}
for b in eb:
    b.use_connect = False
    orig_rot[b.name] = b.matrix.to_3x3().normalized().to_4x4()
for b in eb:
    if b.name not in targets:
        continue
    short = b.name.replace("mixamorig:", "")
    side = 1 if "Left" in short else -1
    rot = b.matrix.to_3x3().to_4x4()
    if any(k in short for k in ("Arm", "Hand")):
        Rw = Matrix.Rotation(arm_angle * side, 4, "Y")
        rot = Rw @ rot   # armature object has no rotation, only a uniform 0.01 scale
    length = b.length
    head_local = mwi @ Vector(targets[b.name])
    b.matrix = Matrix.Translation(head_local) @ rot
    b.length = length * (arm_s if any(k in short for k in ("Arm", "Hand")) else leg_s)
# Bone heat weighting skins by distance to each head->tail segment. Xbot's imported tails
# are arbitrary (leaf/foot bones run metres straight up), so for binding every bone points
# at its child joint. The original axes are put back after binding (animations need them).
MAIN_CHILD = {"Hips": "Spine", "Spine2": "Neck", "LeftShoulder": "LeftArm", "RightShoulder": "RightArm",
              "LeftHand": "LeftHandMiddle1", "RightHand": "RightHandMiddle1", "Head": "HeadTop_End"}
for b in eb:
    short = b.name.replace("mixamorig:", "")
    kids = [c for c in b.children if "Eye" not in c.name]
    want = MAIN_CHILD.get(short)
    child = next((c for c in kids if c.name == "mixamorig:" + want), None) if want else (kids[0] if kids else None)
    if child is not None and (child.head - b.head).length > 1e-4:
        b.tail = child.head.copy()
    else:
        par = b.parent
        d = (b.head - par.head).normalized() if par else Vector((0, 0, 1))
        b.tail = b.head + d * 3.0      # 3 local units = 3 cm
bpy.ops.object.mode_set(mode="OBJECT")
rig.data.pose_position = "POSE"

if PREVIEW:  # joint dots over the mesh, front view, before binding
    os.makedirs(PREVIEW, exist_ok=True)
    dots = []
    for nm, q in targets.items():
        if any(k in nm for k in ("Thumb", "Index", "Middle", "Ring", "Pinky", "Eye")):
            continue
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=(q[0], -0.4, q[2]))
        dots.append(bpy.context.active_object)
    scene.render.engine = "BLENDER_WORKBENCH"; scene.display.shading.color_type = "OBJECT"
    scene.render.resolution_x = scene.render.resolution_y = 700
    cam = bpy.data.objects.new("dbgcam", bpy.data.cameras.new("dbgcam")); scene.collection.objects.link(cam)
    scene.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.95
    cam.location = Vector((0, -6, 0.9)); cam.rotation_euler = (math.radians(90), 0, 0)
    for o in dots: o.color = (1, 0.1, 0.1, 1)
    scene.render.filepath = os.path.join(PREVIEW, "joints.png"); bpy.ops.render.render(write_still=True)
    for o in dots: bpy.data.objects.remove(o)
    bpy.data.objects.remove(cam)
    scene.display.shading.color_type = "TEXTURE"



def stage_render(tag, action=None, frame=1, dots=False):
    if not PREVIEW:
        return
    os.makedirs(PREVIEW, exist_ok=True)
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.get(action) if action else None
    if not action:
        for pb in rig.pose.bones:
            pass
    scene.frame_set(frame); bpy.context.view_layer.update()
    made = []
    if dots:
        for pb in rig.pose.bones:
            if any(k in pb.name for k in ("Thumb", "Index", "Middle", "Ring", "Pinky", "Eye", "End")):
                continue
            w = rig.matrix_world @ pb.head
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=(w.x, w.y - 0.5, w.z))
            o = bpy.context.active_object; o.color = (1, 0, 0, 1); made.append(o)
    scene.render.engine = "BLENDER_WORKBENCH"; scene.display.shading.color_type = "OBJECT" if dots else "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 420
    cam = bpy.data.objects.new("scam", bpy.data.cameras.new("scam")); scene.collection.objects.link(cam)
    scene.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.3
    cam.location = Vector((0, -6, 0.95)); cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = os.path.join(PREVIEW, f"stage_{tag}.png"); bpy.ops.render.render(write_still=True)
    for o in made: bpy.data.objects.remove(o)
    bpy.data.objects.remove(cam)

# ---------------------------------------------------------------- bind
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix()
rig.animation_data_create(); rig.animation_data.action = None
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
unweighted = sum(1 for vx in body.data.vertices if not any(g.weight > 0.01 for g in vx.groups))
print(f"BIND unweighted_vertices={unweighted} of {len(body.data.vertices)}")

# Bone heat only reaches geometry the skeleton sits inside, so anything floating
# clear of the body — a ponytail, the tongue of a shoe — comes back with no
# weights at all. The glTF exporter then parents those vertices to a static
# "neutral_bone" and they stay behind when the character moves. Pin each one to
# whichever bone it is physically nearest instead.
if unweighted:
    mw_inv = body.matrix_world.inverted()
    segs = []
    for b in rig.data.bones:
        if not b.use_deform:
            continue
        segs.append((b.name,
                     mw_inv @ (rig.matrix_world @ b.head_local),
                     mw_inv @ (rig.matrix_world @ b.tail_local)))

    def nearest_bone(p):
        best, found = 1e18, None
        for name, h, t in segs:
            d = t - h
            ln = d.length_squared
            u = 0.0 if ln < 1e-12 else max(0.0, min(1.0, (p - h).dot(d) / ln))
            dist = (p - (h + d * u)).length_squared
            if dist < best:
                best, found = dist, name
        return found

    repaired = {}
    for vx in body.data.vertices:
        if any(g.weight > 0.01 for g in vx.groups):
            continue
        name = nearest_bone(vx.co)
        if not name:
            continue
        grp = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
        grp.add([vx.index], 1.0, "REPLACE")
        repaired[name] = repaired.get(name, 0) + 1
    print("REWEIGHTED", sum(repaired.values()), "stray vertices ->",
          sorted(repaired.items(), key=lambda kv: -kv[1])[:5])

stage_render("1_bound", dots=True)

# pose arms back up to horizontal, bake into the mesh, apply as rest
bpy.ops.object.select_all(action="DESELECT"); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for side, nm in ((1, "mixamorig:LeftArm"), (-1, "mixamorig:RightArm")):
    pb = rig.pose.bones[nm]
    head_w = rig.matrix_world @ pb.head
    Rw = Matrix.Translation(head_w) @ Matrix.Rotation(-arm_angle * side, 4, "Y") @ Matrix.Translation(-head_w)
    pb.matrix = mwi @ Rw @ mw @ pb.matrix
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
bpy.context.view_layer.objects.active = body
mod = [m for m in body.modifiers if m.type == "ARMATURE"][0]
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action="DESELECT"); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.pose.armature_apply(selected=False)
# restore Xbot's exact bone axes (binding used child-pointing tails) so the clips'
# local rotations land on the axes they were authored for
bpy.ops.object.mode_set(mode="EDIT")
for b in rig.data.edit_bones:
    if True:
        head, L = b.head.copy(), b.length
        b.matrix = Matrix.Translation(head) @ orig_rot[b.name]
        b.length = L
bpy.ops.object.mode_set(mode="OBJECT")
m = body.modifiers.new("Armature", "ARMATURE"); m.object = rig
stage_render("2_tpose", dots=True)
# experiment: manual arm-down pose on the final rig
rig.animation_data.action = None
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
for sd, sg in (("Left", 1), ("Right", -1)):
    pb = rig.pose.bones["mixamorig:%sArm" % sd]
    hw = rig.matrix_world @ pb.head
    Rw = Matrix.Translation(hw) @ Matrix.Rotation(math.radians(60) * sg, 4, "Y") @ Matrix.Translation(-hw)
    pb.matrix = mwi @ Rw @ mw @ pb.matrix
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode="OBJECT")
stage_render("2b_manual_down", dots=True)
for pb in rig.pose.bones: pb.matrix_basis = Matrix()
act = bpy.data.actions["walk"]
for fc in act.fcurves:
    if "LeftArm\"" in fc.data_path or "LeftShoulder" in fc.data_path:
        print("FC", fc.data_path, fc.array_index, round(fc.evaluate(7), 3))
stage_render("3_walk", "walk", 7, dots=True)
stage_render("4_walk_tex", "walk", 7)

# probe: shoulder-shelf vertices
import numpy as _np
co = _np.array([vx.co[:] for vx in body.data.vertices])
gnames = {g.index: g.name for g in body.vertex_groups}
cand = _np.where((co[:, 0] > 0.26) & (co[:, 0] < 0.36) & (co[:, 2] > 1.25) & (co[:, 2] < 1.40))[0][:4]
rig.animation_data.action = bpy.data.actions["idle"]; scene.frame_set(1); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
for i in cand:
    ws = sorted(((gnames[g.group].replace("mixamorig:", ""), round(g.weight, 2)) for g in body.data.vertices[i].groups), key=lambda x: -x[1])[:4]
    print("VTX", i, _np.round(co[i], 3), "->", _np.round(_np.array(me.vertices[i].co[:]), 3), ws)
ev.to_mesh_clear()
print("MODS", [(m.type, m.object.name if m.object else None, m.use_vertex_groups, m.use_bone_envelopes) for m in body.modifiers], "PARENT", body.parent.name if body.parent else None, body.parent_type)
print("RIGDATA", rig.data.pose_position, [(c.name) for c in rig.pose.bones["mixamorig:LeftArm"].constraints])
# ---------------------------------------------------------------- textures + export
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
        img.pack()

rig.animation_data.action = bpy.data.actions.get("idle")
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"; scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 420
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
    scene.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.3
    for act, frames in (("idle", [1]), ("walk", [1, 7, 13]), ("run", [1, 5, 9])):
        rig.animation_data.action = bpy.data.actions[act]
        for f in frames:
            for view, ang in (("front", 0), ("side", 90)):
                a = math.radians(ang)
                cam.location = Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.95))
                cam.rotation_euler = (math.radians(90), 0, a)
                scene.frame_set(f)
                scene.render.filepath = os.path.join(PREVIEW, f"{act}_{f:02d}_{view}.png")
                bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

rig.animation_data.action = bpy.data.actions.get("idle")
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"; scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 420
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
    scene.camera = cam; cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.3
    for act, frames in (("idle", [1]), ("walk", [1, 7, 13]), ("run", [1, 5, 9])):
        rig.animation_data.action = bpy.data.actions[act]
        for f in frames:
            for view, ang in (("front", 0), ("side", 90)):
                a = math.radians(ang)
                cam.location = Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.95))
                cam.rotation_euler = (math.radians(90), 0, a)
                scene.frame_set(f)
                scene.render.filepath = os.path.join(PREVIEW, f"{act}_{f:02d}_{view}.png")
                bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

# Note: do NOT auto-smooth here. In Blender 4.1+ shade_auto_smooth adds a
# geometry-nodes modifier, which sits alongside the Armature modifier and
# corrupts the skinning on export — the arms come out stretched into tubes. The
# blocky look it was meant to fix was never shading anyway; it was the garments
# exporting alpha-blended, which tools/athletic_wear.py now turns off.

rig.animation_data.action = bpy.data.actions.get("idle")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True,
                          export_animation_mode="ACTIONS", export_skins=True,
                          export_image_format="WEBP", export_yup=True)
print("EXPORTED", OUT)
