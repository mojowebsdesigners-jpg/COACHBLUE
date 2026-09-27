"""Studio: soft key, low fill, two rims, a neutral grey sweep, three cameras.

The lighting is deliberately plain — a lit character, not a mood piece — so
modelling problems show instead of hiding in shadow.
"""
import bpy, math
from mathutils import Vector
from common import collection, hex_lin, landmarks


def area(name, loc, target, energy, size, col, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA")
    d.energy, d.size, d.color = energy, size, color
    d.shape = "DISK"
    o = bpy.data.objects.new(name, d)
    col.objects.link(o)
    o.location = loc
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y")
    return o


def look(cam, target):
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (Vector(target) - cam.location).to_track_quat("-Z", "Y")


def build(height):
    lights = collection("LIGHTING")
    cams = collection("CAMERAS")
    chest = (0, 0, height * 0.72)

    # MPFB faces -Y, so the camera side is -Y
    area("L_Key", (-1.9, -2.6, 2.6), chest, 700, 2.6, lights, (1.0, 0.97, 0.93))
    area("L_Fill", (2.4, -2.2, 1.4), chest, 70, 3.0, lights, (0.93, 0.96, 1.0))
    area("L_RimL", (-1.6, 2.0, 2.3), (0, 0, height * 0.8), 450, 1.2, lights)
    area("L_RimR", (1.7, 1.9, 2.0), (0, 0, height * 0.75), 380, 1.2, lights)

    # the grey sweep: a floor that curves up into a wall, so there is no horizon line
    bpy.ops.mesh.primitive_plane_add(size=1)
    sweep = bpy.context.active_object
    sweep.name = "Studio_Sweep"
    for c in list(sweep.users_collection):
        c.objects.unlink(sweep)
    lights.objects.link(sweep)
    import bmesh
    profile = [(-4.0, 0.0)]
    for i in range(24):
        ang = i / 23 * math.pi / 2
        profile.append((1.8 + math.sin(ang) * 1.2, 1.2 - math.cos(ang) * 1.2))
    profile.append((3.0, 6.0))
    bm = bmesh.new()
    rows = [(bm.verts.new((-5, y, z)), bm.verts.new((5, y, z))) for y, z in profile]
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    bm.to_mesh(sweep.data)
    bm.free()
    for p in sweep.data.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new("M_Studio")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_lin("#45484c")
    b.inputs["Roughness"].default_value = 0.8
    sweep.data.materials.append(m)

    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = hex_lin("#44474b")
    bg.inputs[1].default_value = 0.35

    lm = landmarks()
    eyes = (lm["eye_l"] + lm["eye_r"]) / 2
    out = {}

    def camera(name, loc, target, lens):
        d = bpy.data.cameras.new(name)
        d.lens = lens
        d.clip_start = 0.05
        o = bpy.data.objects.new(name, d)
        cams.objects.link(o)
        o.location = loc
        look(o, target)
        out[name] = o
        return o

    camera("CAM_Front", (0, -6.2, height * 0.55), (0, 0, height * 0.52), 65)
    a = math.radians(45)
    camera("CAM_ThreeQuarter", (-6.2 * math.sin(a), -6.2 * math.cos(a), height * 0.58),
           (0, 0, height * 0.55), 65)
    c = camera("CAM_CloseUp", (-0.35, -1.25, eyes[2] - 0.02), (0, eyes[1], eyes[2] - 0.12), 85)
    c.data.dof.use_dof = True
    c.data.dof.focus_distance = 1.2
    c.data.dof.aperture_fstop = 4.0
    return out


def render(cam, path, engine="EEVEE", res=(900, 1600), samples=96):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.35
    if engine == "CYCLES":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.02
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        e = scene.eevee
        e.taa_render_samples = 48
        e.use_raytracing = True
        e.use_shadows = True
        e.ray_tracing_options.resolution_scale = "2"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
