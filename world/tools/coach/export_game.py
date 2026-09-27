"""Turn the hero character into a web-game mesh: baked textures, no strands.

    blender -b raw/coach_hero/coach_hero.blend -P tools/coach/export_game.py -- \\
        <out.glb> <tex_dir> [xbot=raw/Xbot.glb] [size=1024] [samples=4] [outfits=1]

The hero file is built for Cycles: procedural skin, knit and seam shaders,
strand hair, a refractive cornea, a sub-divided cage. None of that survives a
glTF export or a phone GPU, so this bakes it down:

  * every garment and the skin get their shader baked to a colour map and a
    tangent-space normal map on their own UVs (the garments inherit the
    body's MakeHuman UV layout, so seams, stitching and the logo land in the
    right place);
  * brows, stubble and the fade are painted into the skin bake from the same
    zones the strands grow from;
  * the coiled top becomes a shell over the scalp, displaced into clumps and
    textured by its own baked shader;
  * the cornea and lashes are dropped; the eyeball's iris is baked.

Rigging reuses MakeHuman's own skin weights instead of guessing new ones.
The game drives the Mixamo skeleton from three.js's Xbot sample (its idle,
walk, run, agree and headShake clips), so:

  1. the MakeHuman rig is posed so every limb points the way Xbot's does in
     its rest pose (arms straight out, legs straight down), and the meshes
     are taken in that pose;
  2. each Xbot joint is moved onto the matching MakeHuman joint, keeping
     Xbot's bone orientations so its clips still apply unchanged;
  3. the weight groups are renamed to the Mixamo bones they correspond to.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (body, collection, group_weights, hex_lin, landmarks, link, node,
                    rest_coords, rig, set_point_attr)
import hair as hairmod
import clothes as clothmod

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, TEX = os.path.abspath(argv[0]), os.path.abspath(argv[1])
opts = dict(a.split("=", 1) for a in argv[2:])
SIZE = int(opts.get("size", "1024"))
SAMPLES = int(opts.get("samples", "4"))
XBOT = os.path.abspath(opts.get("xbot", "raw/Xbot.glb"))
KEEP_CLIPS = {"idle", "walk", "run", "agree", "headShake"}
# Two outfits in one file: the skin the shirt hides is kept and marked with a
# "_SHIRT" vertex attribute, so the game can take the shirt off by drawing it.
# With the shirt on that skin is discarded, and the character is exactly what
# it was with the skin cut away under the cloth.
OUTFITS = opts.get("outfits", "1") == "1"

# MakeHuman game_engine bone -> Mixamo bone (without the "mixamorig:" prefix)
MAP = {"pelvis": "Hips", "spine_01": "Spine", "spine_02": "Spine1", "spine_03": "Spine2",
       "neck_01": "Neck", "head": "Head"}
for s_mh, s_mx in (("l", "Left"), ("r", "Right")):
    MAP.update({f"clavicle_{s_mh}": f"{s_mx}Shoulder", f"upperarm_{s_mh}": f"{s_mx}Arm",
                f"lowerarm_{s_mh}": f"{s_mx}ForeArm", f"hand_{s_mh}": f"{s_mx}Hand",
                f"thigh_{s_mh}": f"{s_mx}UpLeg", f"calf_{s_mh}": f"{s_mx}Leg",
                f"foot_{s_mh}": f"{s_mx}Foot", f"ball_{s_mh}": f"{s_mx}ToeBase"})
    for f_mh, f_mx in (("thumb", "Thumb"), ("index", "Index"), ("middle", "Middle"),
                       ("ring", "Ring"), ("pinky", "Pinky")):
        for j in (1, 2, 3):
            MAP[f"{f_mh}_0{j}_{s_mh}"] = f"{s_mx}Hand{f_mx}{j}"
os.makedirs(TEX, exist_ok=True)

scene = bpy.context.scene


def load_xbot():
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=XBOT)
    imported = [o for o in scene.objects if o not in before]
    arm = [o for o in imported if o.type == "ARMATURE"][0]
    if arm.animation_data:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    for o in imported:
        if o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        base = a.name.replace("_Armature", "")
        if base in KEEP_CLIPS:
            a.name = base
            a.use_fake_user = True
        elif a.name.endswith("_Armature"):
            bpy.data.actions.remove(a)
    arm.name = "Armature"
    bpy.context.view_layer.update()
    return arm


XB = load_xbot()


CHILD = {"Arm": "ForeArm", "ForeArm": "Hand", "Hand": "HandMiddle1", "UpLeg": "Leg", "Leg": "Foot"}


def xb_dir(name):
    """Xbot's limb direction: joint to child joint. Bone tails from the glTF
    importer are guesses and can point anywhere, so they are not used."""
    side = "Left" if name.startswith("Left") else "Right"
    part = name[len(side):]
    mw = XB.matrix_world
    h = mw @ XB.data.bones[f"mixamorig:{name}"].head_local
    c = mw @ XB.data.bones[f"mixamorig:{side}{CHILD[part]}"].head_local
    return (c - h).normalized()


def t_pose():
    """Pose every limb the way Xbot's points in its rest pose.

    MakeHuman's rest pose has the elbows bent, forearms reaching forward.
    rig.py only rotates the arm chain up about the body's depth axis, so a bent
    forearm would stay pointing forward in its T-pose and every clip would end
    with the hands crossing in front of the hips. Posing the arms straight here,
    with MakeHuman's own weights, leaves rig.py nothing to correct.
    """
    import pose as posemod
    r = rig()
    r.data.pose_position = "POSE"
    for pb in r.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    made, names = [], []
    for side in ("l", "r"):
        for bone in ("upperarm", "lowerarm", "hand", "thigh", "calf"):
            n = f"{bone}_{side}"
            head = r.matrix_world @ r.pose.bones[n].head
            far = posemod.empty(f"T_{n}", head + xb_dir(MAP[n]) * 5.0)
            print("DIR", n, tuple(round(x, 2) for x in xb_dir(MAP[n])))
            made.append(far)
            c = r.pose.bones[n].constraints.new("DAMPED_TRACK")
            c.target, c.track_axis = far, "TRACK_Y"
            names.append(n)
    posemod.bake(r, names)
    for e in made:
        bpy.data.objects.remove(e, do_unlink=True)
    bpy.context.view_layer.update()


t_pose()
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.render.bake.margin = 8
game_col = bpy.data.collections.new("GAME_EXPORT")
scene.collection.children.link(game_col)


# ---------------------------------------------------------------- helpers
def game_copy(src, name, keep=("MASK", "ARMATURE")):
    """The rest-pose mesh of `src` with only the listed modifier types applied."""
    saved = [(m, m.show_viewport) for m in src.modifiers]
    for m, _ in saved:
        m.show_viewport = m.type in keep
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), preserve_all_data_layers=True,
                                         depsgraph=dg)
    for m, v in saved:
        m.show_viewport = v
    obj = bpy.data.objects.new(name, me)
    game_col.objects.link(obj)
    obj.matrix_world = src.matrix_world.copy()
    if src.type == "MESH":
        for g in src.vertex_groups:
            obj.vertex_groups.new(name=g.name)
    if src.parent_type == "BONE" and src.parent_bone:
        # rigid accessories ride one bone
        g = obj.vertex_groups.get(src.parent_bone) or obj.vertex_groups.new(name=src.parent_bone)
        g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def ensure_uv(obj):
    if obj.data.uv_layers:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(obj, name, kinds=("DIFFUSE", "NORMAL"), size=SIZE):
    ensure_uv(obj)
    out = {}
    for kind in kinds:
        img = bpy.data.images.new(f"{name}_{kind.lower()}", size, size, alpha=False)
        if kind == "NORMAL":
            img.colorspace_settings.name = "Non-Color"
        added = []
        for slot in obj.material_slots:
            nt = slot.material.node_tree
            n = nt.nodes.new("ShaderNodeTexImage")
            n.image = img
            nt.nodes.active = n
            added.append((nt, n))
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if kind == "DIFFUSE":
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True)
        for nt, n in added:
            nt.nodes.remove(n)
        img.filepath_raw = os.path.join(TEX, f"{name}_{kind.lower()}.png")
        img.file_format = "PNG"
        img.save()
        out[kind] = img
        print(f"BAKED {name} {kind} {size}px")
    return out


def game_material(name, imgs=None, rough=0.7, metal=0.0, color=None, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if color:
        b.inputs["Base Color"].default_value = hex_lin(color)
    if imgs and "DIFFUSE" in imgs:
        tx = t.nodes.new("ShaderNodeTexImage")
        tx.image = imgs["DIFFUSE"]
        t.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    if imgs and "NORMAL" in imgs:
        tn = t.nodes.new("ShaderNodeTexImage")
        tn.image = imgs["NORMAL"]
        nm = t.nodes.new("ShaderNodeNormalMap")
        t.links.new(tn.outputs["Color"], nm.inputs["Color"])
        t.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ---------------------------------------------------------------- skin
def paint_face_hair(obj):
    """Brows and the beard shadow as skin masks, from the strand zones."""
    co = rest_coords(body())
    lm = landmarks()
    brow = sum(hairmod.brow_weight(co, lm, s, sg) for s, sg in (("l", 1), ("r", -1)))
    stub = hairmod.stubble_weight(co, lm, body()) * (1.0 if hairmod.PROF["stubble"] else 0.0)
    # the game copy lost the masked vertices; map each kept one to its source
    from mathutils.kdtree import KDTree
    kd = KDTree(len(co))
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    mw = obj.matrix_world
    idx = np.array([kd.find(mw @ v.co)[1] for v in obj.data.vertices])
    set_point_attr(obj, "m_brow", brow[idx])
    set_point_attr(obj, "m_stub", stub[idx])


def add_face_hair_to_skin(mat):
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    base_link = bsdf.inputs["Base Color"].links[0]
    cur = base_link.from_socket
    tc = node(t, "ShaderNodeTexCoord", (-400, 900))
    streak = node(t, "ShaderNodeTexNoise", (-200, 900), Scale=1400.0, Detail=2.0)
    sm = node(t, "ShaderNodeMapping", (-300, 900))
    sm.inputs["Scale"].default_value = (0.25, 1.0, 1.0)     # hairs run sideways
    link(t, tc.outputs["Object"], sm.inputs[0])
    link(t, sm.outputs[0], streak.inputs["Vector"])
    for attr_name, amount, y in (("m_brow", 0.95, 1100), ("m_stub", 0.35, 1300)):
        a = node(t, "ShaderNodeAttribute", (0, y))
        a.attribute_name = attr_name
        f = node(t, "ShaderNodeMath", (200, y))
        f.operation = "MULTIPLY"
        link(t, a.outputs["Fac"], f.inputs[0])
        link(t, streak.outputs["Fac"], f.inputs[1])
        f2 = node(t, "ShaderNodeMath", (350, y))
        f2.operation = "MULTIPLY"
        link(t, f.outputs[0], f2.inputs[0])
        f2.inputs[1].default_value = amount * 1.6
        mix = node(t, "ShaderNodeMix", (550, y))
        mix.data_type = "RGBA"
        mix.clamp_factor = True
        link(t, f2.outputs[0], mix.inputs["Factor"])
        link(t, cur, mix.inputs["A"])
        mix.inputs["B"].default_value = hex_lin("#0d0a09")
        cur = mix.outputs["Result"]
    link(t, cur, bsdf.inputs["Base Color"])


# ---------------------------------------------------------------- hair shell
def hair_shell():
    src = body()
    co = rest_coords(src)
    lm = landmarks()
    top, env, shade = hairmod.style_zones(co, src, lm)
    obj = clothmod.rest_mesh_copy(src, "CB_HairShell")
    # the shell rides the head rigidly
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    game_col.objects.link(obj)
    set_point_attr(obj, "env", env)
    clothmod.keep_only(obj, top > 0)
    clothmod.subdivide(obj)
    pc, pn, pe = clothmod.arrays(obj)
    e = np.empty(len(pc), dtype=np.float32)
    obj.data.attributes["env"].data.foreach_get("value", e)
    # clumps: the shell swells and dips on the scale of the coils in the photo
    bumps = np.array([noise.noise(Vector(p * 170)) for p in pc])
    pc = pc + pn * (e * 0.88 + 0.001 + bumps * 0.0022)[:, None]
    pc = clothmod.laplacian(pc, pe, 3, 0.4, pinned=clothmod.boundary_verts(obj))
    clothmod.put(obj, pc)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.vertex_groups.new(name="head").add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")

    m = bpy.data.materials.new("M_HairShellBake")
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    tc = node(t, "ShaderNodeTexCoord", (-900, 0))
    clump = node(t, "ShaderNodeTexVoronoi", (-600, 0), Scale=260.0)
    clump.feature = "F1"
    link(t, tc.outputs["Object"], clump.inputs["Vector"])
    strand = node(t, "ShaderNodeTexNoise", (-600, -300), Scale=2600.0, Detail=3.0)
    link(t, tc.outputs["Object"], strand.inputs["Vector"])
    ramp = node(t, "ShaderNodeValToRGB", (-300, 0))
    link(t, clump.outputs["Distance"], ramp.inputs[0])
    # lit crowns and dark roots, from the profile's hair pigment
    brown = 1.0 - hairmod.PROF["hair"]["melanin"]
    ramp.color_ramp.elements[0].color = hex_lin("#2a1c15" if brown < 0.05 else "#5a3a22")
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = hex_lin("#070605" if brown < 0.05 else "#1c110a")     # dark between clumps
    mix = node(t, "ShaderNodeMix", (0, 0))
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.5
    link(t, ramp.outputs[0], mix.inputs["A"])
    link(t, strand.outputs["Color"], mix.inputs["B"])
    link(t, mix.outputs["Result"], b.inputs["Base Color"])
    bump1 = node(t, "ShaderNodeBump", (0, -400), Strength=0.8, Distance=0.002)
    inv = node(t, "ShaderNodeMath", (-300, -400))
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    link(t, clump.outputs["Distance"], inv.inputs[1])
    link(t, inv.outputs[0], bump1.inputs["Height"])
    bump2 = node(t, "ShaderNodeBump", (200, -500), Strength=0.4, Distance=0.0004)
    link(t, strand.outputs["Fac"], bump2.inputs["Height"])
    link(t, bump1.outputs[0], bump2.inputs["Normal"])
    link(t, bump2.outputs[0], b.inputs["Normal"])
    obj.data.materials.append(m)
    return obj


# ---------------------------------------------------------------- outfits
def mark_shirt_only():
    """Keep the skin that only the shirt covers, and tag it for splitting off.

    The body's "covered" group hides every vertex under any garment. Those
    that sit under the trousers or the shoes stay hidden; the rest were hidden
    only by the shirt, so they are taken out of the group (the torso is baked
    and exported) and tagged with a "shirt_only" attribute.
    """
    from mathutils.kdtree import KDTree
    src = body()
    co = rest_coords(src)
    cov = group_weights(src, "covered") > 0
    under = np.zeros(len(co), dtype=bool)
    for name in ("CB_Pants", "CB_Pocket", "CB_PocketFlap"):
        o = bpy.data.objects.get(name)
        if not o:
            continue
        pc = rest_coords(o)
        kd = KDTree(len(pc))
        for i, p in enumerate(pc):
            kd.insert(p, i)
        kd.balance()
        for i in np.where(cov & ~under)[0]:
            p, _, d = kd.find(co[i])
            # near the trousers AND no higher than they come up: skin just
            # above the waistband is near it too, but it is the shirt's skin
            if d < 0.035 and p[2] >= co[i][2] - 0.006:
                under[i] = True
    w_foot = sum(group_weights(src, n) for n in ("foot_l", "foot_r", "ball_l", "ball_r", "calf_l", "calf_r"))
    under |= cov & (w_foot > 0.5)
    shirt_only = cov & ~under
    set_point_attr(src, "shirt_only", shirt_only.astype(np.float32))
    src.vertex_groups["covered"].remove([int(i) for i in np.where(shirt_only)[0]])
    print(f"OUTFITS shirt-only skin verts={int(shirt_only.sum())} still covered={int((cov & under).sum())}")


# ---------------------------------------------------------------- build
made = []

if OUTFITS:
    mark_shirt_only()
g_body = game_copy(body(), "CB_Body_game")
paint_face_hair(g_body)
add_face_hair_to_skin(g_body.material_slots[0].material)
imgs = bake(g_body, "skin")
assign(g_body, game_material("CB_Skin", imgs, rough=0.48))
if OUTFITS:
    # One skin, not two: the shirt-only area is marked with an exported
    # attribute, and the game discards it while the shirt is on. Splitting it
    # into its own mesh put a lighting seam round the neckline and sleeves,
    # because two meshes never agree on the normals along their cut.
    so = g_body.data.attributes.get("shirt_only")
    vals = np.zeros(len(g_body.data.vertices), dtype=np.float32)
    if so:
        so.data.foreach_get("value", vals)
    set_point_attr(g_body, "_SHIRT", vals)
made.append(g_body)

for name, rough in (("CB_Shirt", 0.8), ("CB_Pants", 0.86)):
    g = game_copy(bpy.data.objects[name], f"{name}_game")
    imgs = bake(g, name.lower().replace("cb_", ""))
    mat = game_material(name, imgs, rough=rough, double=True)
    assign(g, mat)
    made.append(g)
    if name == "CB_Pants":
        # pockets sit on the pants' own UVs, so they reuse its bake
        for pn in ("CB_Pocket", "CB_PocketFlap"):
            if pn in bpy.data.objects:
                gp = game_copy(bpy.data.objects[pn], f"{pn}_game")
                assign(gp, mat)
                made.append(gp)

shell = hair_shell()
if hairmod.STYLE == "ponytail":
    # the tail rides the head with the shell, and shares its baked material
    _co, _tris = hairmod.surface(body())
    tail = hairmod.tail_mesh(hairmod.tie_point(landmarks(), _co, _tris), shell.data.materials[0], game_col)
    tail.vertex_groups.new(name="head").add(list(range(len(tail.data.vertices))), 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    tail.select_set(True)
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.join()
    shell = bpy.context.active_object
imgs = bake(shell, "hair", size=SIZE // 2)
hair_mat = game_material("CB_Hair", imgs, rough=0.82)
hair_mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.2
assign(shell, hair_mat)
made.append(shell)

for side in ("L", "R"):
    ball = bpy.data.objects.get(f"CB_Eye_{side}")
    if ball:
        g = game_copy(ball, f"CB_Eye_{side}_game")
        imgs = bake(g, f"eye_{side.lower()}", kinds=("DIFFUSE",), size=256)
        assign(g, game_material("CB_Eye", imgs, rough=0.12))
        made.append(g)
    for part, col, rough in ((f"CB_Shoe_{side}", "#101112", 0.8), (f"CB_Sole_{side}", "#1c1c1d", 0.9)):
        if part in bpy.data.objects:
            g = game_copy(bpy.data.objects[part], f"{part}_game", keep=("BEVEL",))
            assign(g, game_material(part.split("_")[1], rough=rough, color=col))
            made.append(g)

for part, col, rough in (("CB_Necklace", "#1e1e22", 0.3), ("CB_Cross", "#18181b", 0.25)):
    if part in bpy.data.objects:
        g = game_copy(bpy.data.objects[part], f"{part}_game", keep=("BEVEL",))
        assign(g, game_material("CB_Chain", rough=rough, metal=1.0, color=col))
        made.append(g)

# ---------------------------------------------------------------- rig
bpy.ops.object.select_all(action="DESELECT")
for o in made:
    o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
char = bpy.context.view_layer.objects.active
char.name = "CoachBody"
print(f"GAME verts={len(char.data.vertices)} materials={len(char.data.materials)}")

# joints: every mapped Xbot bone moves onto its MakeHuman joint (in the pose the
# meshes were taken in); unmapped ones (finger tips, head top, toe end) ride
# along with their parent. Directions and rolls stay Xbot's.
mh = rig()
joint = {MAP[n]: mh.matrix_world @ mh.pose.bones[n].head for n in MAP}
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = XB
XB.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
mwi = XB.matrix_world.inverted()
ebs = XB.data.edit_bones
for eb in ebs:
    eb.use_connect = False
delta = {}
for eb in sorted(ebs, key=lambda b: len(b.parent_recursive)):
    short = eb.name.replace("mixamorig:", "")
    vec = eb.tail - eb.head
    if short in joint:
        new_head = mwi @ joint[short]
    elif eb.parent is not None and eb.parent.name in delta:
        new_head = eb.head + delta[eb.parent.name]
    else:
        new_head = eb.head.copy()
    delta[eb.name] = new_head - eb.head
    eb.head = new_head
    eb.tail = new_head + vec
bpy.ops.object.mode_set(mode="OBJECT")

# weights: rename MakeHuman groups to their Mixamo bones
for g in char.vertex_groups:
    if g.name in MAP:
        g.name = f"mixamorig:{MAP[g.name]}"
names = {g.index: g.name for g in char.vertex_groups}
unweighted = sum(1 for v in char.data.vertices
                 if not any(names[e.group].startswith("mixamorig:") and e.weight > 0.01
                            for e in v.groups))
print(f"BIND unweighted={unweighted} of {len(char.data.vertices)}")

char.parent = XB
char.matrix_parent_inverse = XB.matrix_world.inverted()
mod = char.modifiers.new("Armature", "ARMATURE")
mod.object = XB

# drop everything that is not the game character
for o in list(scene.objects):
    if o not in (char, XB):
        bpy.data.objects.remove(o, do_unlink=True)
XB.animation_data_create()
XB.animation_data.action = bpy.data.actions.get("idle")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True,
                          export_animation_mode="ACTIONS", export_skins=True,
                          export_image_format="AUTO", export_yup=True,
                          export_attributes=OUTFITS)
print("WROTE", OUT)
