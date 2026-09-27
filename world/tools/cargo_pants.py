"""Build loose cargo trousers as real geometry over the rigged character.

    blender -b --factory-startup -P tools/cargo_pants.py -- <in.glb> <out.glb> <diffuse.png> <mr.png>

Painting trousers into the body texture leaves them shrink-wrapped to the leg
muscles. This lifts the leg surface off the body into its own garment mesh:
the leg band is copied, relaxed so the quads and calves stop showing through,
then pushed out along its normals by a profile that is full at the thigh and
cinched at the ankle. It keeps the original vertex groups, so the armature
drives it exactly as it drives the body.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
IN, OUT, DIFF, MR = argv[0], argv[1], argv[2], argv[3]

WAIST = 1.075       # top of the waistband, in bind-pose metres
ANKLE = 0.105       # where the trouser is bloused over the boot

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)

# the export carries a stray primitive alongside the character; drop it
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and len(o.data.vertices) < 2000 and o.parent is None:
        print("DROP", o.name)
        bpy.data.objects.remove(o, do_unlink=True)

body = max((o for o in bpy.context.scene.objects if o.type == "MESH"),
           key=lambda o: len(o.data.vertices))
arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
# the mesh is authored in centimetres under a scaled armature, so every
# threshold below is converted through the object's own world scale
UNIT = body.matrix_world.to_scale().z or 1.0
M = body.matrix_world
print("BODY", body.name, len(body.data.vertices), "verts; armature", arm and arm.name,
      "; unit", round(UNIT, 4))


def offset_at(y):
    """How far the cloth stands off the skin at this height, in metres."""
    if y > 0.92:                       # waistband, snug
        return 0.016
    if y > 0.60:                       # thigh, full cut
        return 0.040
    if y > 0.50:                       # over the knee
        return 0.032
    if y > 0.20:                       # calf, loose and straight
        return 0.044
    return 0.046 * max(0.0, (y - ANKLE) / 0.095) + 0.012   # tapers into the blouse


# ---------------------------------------------------------------- cut the band
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
pants = bpy.context.active_object
pants.name = "CargoPants"

bm = bmesh.new()
bm.from_mesh(pants.data)
bm.verts.ensure_lookup_table()
def height(v):
    return (M @ v.co).z

kill = [v for v in bm.verts if height(v) > WAIST or height(v) < ANKLE]
bmesh.ops.delete(bm, geom=kill, context="VERTS")
# glTF splits a vertex wherever the UVs seam, so the imported surface is a set
# of disconnected shells. Smoothing them separately tears the garment open
# along every seam, so weld first and deform one continuous surface.
before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4 / UNIT)
print("WELDED", before - len(bm.verts), "seam duplicates")
bm.to_mesh(pants.data)
bm.free()
print("PANTS band", len(pants.data.vertices), "verts")

# ------------------------------------------------- relax, inflate, then clear
# Laplacian smoothing is what stops every quadriceps and calf head reading
# through the cloth, but it also shrinks the surface, so the body can surface
# through the garment. Keep the pre-smooth shape to push back out against.
orig = [v.co.copy() for v in pants.data.vertices]
base_n = [Vector(v.normal) for v in pants.data.vertices]

sm = pants.modifiers.new("Relax", "SMOOTH")
sm.factor = 1.0
sm.iterations = 9
bpy.context.view_layer.objects.active = pants
bpy.ops.object.modifier_apply(modifier=sm.name)

bm = bmesh.new()
bm.from_mesh(pants.data)
bm.verts.ensure_lookup_table()
bm.normal_update()
for i, v in enumerate(bm.verts):
    n = base_n[i].copy()
    # cloth hangs around the leg, it does not grow off the top of the thigh
    n.z *= 0.25
    if n.length < 1e-6:
        continue
    n.normalize()
    gap = offset_at(height(v)) / UNIT
    # first the shape: keep most of the relaxed surface, then stand it off the
    # skin along the direction the skin actually faces
    v.co += n * gap
    # clearance: the garment may never sit closer to its own skin vertex than
    # the gap, whatever the smoothing did
    d = (v.co - orig[i]).dot(n)
    if d < gap:
        v.co += n * (gap - d)
bm.to_mesh(pants.data)
bm.free()

# a light settle closes the creases the inflation opens up, without pulling the
# surface back into the body
sm = pants.modifiers.new("Settle", "SMOOTH")
sm.factor = 0.35
sm.iterations = 3
bpy.ops.object.modifier_apply(modifier=sm.name)

bm = bmesh.new()
bm.from_mesh(pants.data)
bm.verts.ensure_lookup_table()
poked = 0
for i, v in enumerate(bm.verts):
    n = base_n[i].copy()
    n.z *= 0.25
    if n.length < 1e-6:
        continue
    n.normalize()
    gap = (offset_at(height(v)) * 0.8) / UNIT
    d = (v.co - orig[i]).dot(n)
    if d < gap:
        v.co += n * (gap - d)
        poked += 1
bm.to_mesh(pants.data)
bm.free()
print("CLEARED", poked, "vertices back out of the body")

# ------------------------------------------------- take the skin out from under
# Offsetting a surface can never guarantee it stays outside a body as detailed
# as this one, and a single poking quad is worse than no garment at all. The
# leg the trousers cover is not visible anyway, so it goes: the trousers become
# the leg, overlapping what is left at the waist and the boot.
bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
hidden = [v for v in bm.verts if ANKLE + 0.03 < height(v) < WAIST - 0.075]
bmesh.ops.delete(bm, geom=hidden, context="VERTS")
bm.to_mesh(body.data)
bm.free()
print("SKINNED OFF", len(hidden), "body verts under the cloth")

# ---------------------------------------------------------------- material
mat = bpy.data.materials.new("CargoPants")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]

tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(os.path.abspath(DIFF))
nt.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])

rough = nt.nodes.new("ShaderNodeTexImage")
rough.image = bpy.data.images.load(os.path.abspath(MR))
rough.image.colorspace_settings.name = "Non-Color"
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(sep.inputs["Color"], rough.outputs["Color"])
nt.links.new(bsdf.inputs["Roughness"], sep.outputs["Green"])
bsdf.inputs["Metallic"].default_value = 0.0

pants.data.materials.clear()
pants.data.materials.append(mat)

# the body keeps its own map, repainted so the waistband and any sliver of leg
# that shows at the hem match the cloth
for slot in body.material_slots:
    m = slot.material
    if not m or not m.use_nodes:
        continue
    for node in m.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image and "diffuse" in (node.image.name or "").lower():
            node.image = bpy.data.images.load(os.path.abspath(DIFF))

# Join the trousers into the body. Exporting them as a second skinned mesh
# gives the glTF two skins over one skeleton, and three.js's skeleton cloning
# does not survive that: the clips stop driving the bones and the procedural
# animation layer, which has nothing resetting it, walks the character over
# onto his face. One mesh with two material slots behaves exactly like the
# original model did.
bpy.ops.object.select_all(action="DESELECT")
pants.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("JOINED into", body.name, len(body.data.vertices), "verts",
      [m.name for m in body.data.materials])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_yup=True,
    export_animations=True, export_skins=True, export_apply=False,
)
print("WROTE", OUT)
