"""Shared helpers for the GT coupe build (run inside Blender).

Axes: the car is modelled nose-first along Blender -Y, so the glTF exporter's
Y-up conversion leaves it facing +Z, which is the way the game's vehicle
controller drives. The driver sits on the car's left, which is +X.
Station `s` is the forward distance from the middle of the wheelbase, so
Blender y = -s.
"""
import bpy
import bmesh
import math
import numpy as np
from mathutils import Matrix, Vector

WHEELBASE = 2.70
FRONT_AXLE = WHEELBASE / 2
REAR_AXLE = -WHEELBASE / 2
TRACK = 1.64
TYRE_R = 0.345
TYRE_W = 0.265
ARCH_R = 0.395


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


_mats = {}


def material(name, color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.03,
             emission=None, strength=0.0, alpha=1.0, spec=0.5):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hex_lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    b.inputs["Specular IOR Level"].default_value = spec
    if emission:
        b.inputs["Emission Color"].default_value = hex_lin(emission)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
        m.use_backface_culling = False
    if name in ("CB_CarTyre", "CB_CarRimLip", "CB_CarRim"):
        m.use_backface_culling = False
    _mats[name] = m
    return m


def mats():
    """The car's palette."""
    return {
        # Coach Blue: a deep metallic midnight blue under a hard clear coat
        "paint": material("CB_CarPaint", "#0c1f4a", rough=0.32, metal=0.75, coat=1.0, coat_rough=0.02),
        "interior": material("CB_CarInterior", "#0b0c0e", rough=0.8),
        "trim": material("CB_CarTrim", "#07080a", rough=0.35, metal=0.2, coat=0.6),
        "plastic": material("CB_CarPlastic", "#101113", rough=0.6),
        "carbon": material("CB_CarCarbon", "#141518", rough=0.3, metal=0.3, coat=1.0),
        "glass": material("CB_CarGlass", "#0a0f14", rough=0.03, alpha=0.32, spec=1.0),
        "chrome": material("CB_CarChrome", "#dadde2", rough=0.06, metal=1.0),
        "reflector": material("CB_CarReflector", "#c9ccd2", rough=0.12, metal=1.0),
        "lens": material("CB_CarLens", "#ffffff", rough=0.02, alpha=0.18, spec=1.0),
        "led": material("CB_CarLED", "#ffffff", rough=0.2, emission="#eef4ff", strength=6.0),
        "drl": material("CB_CarDRL", "#ffffff", rough=0.2, emission="#dfefff", strength=10.0),
        "tail": material("CB_CarTail", "#5a0206", rough=0.15, emission="#ff1a10", strength=1.2),
        "tail_lens": material("CB_CarTailLens", "#3a0205", rough=0.03, alpha=0.55, spec=1.0),
        "indicator": material("CB_CarIndicator", "#6a3500", rough=0.2, emission="#ff8a00", strength=0.3),
        "rubber": material("CB_CarTyre", "#141415", rough=0.88, spec=0.3),
        "rim": material("CB_CarRim", "#2a2c30", rough=0.22, metal=1.0, coat=0.5),
        "rim_lip": material("CB_CarRimLip", "#c7cad0", rough=0.1, metal=1.0),
        "disc": material("CB_CarDisc", "#5c5e62", rough=0.35, metal=1.0),
        "caliper": material("CB_CarCaliper", "#b01818", rough=0.3, coat=1.0),
        "leather": material("CB_CarLeather", "#1a1714", rough=0.55, spec=0.4),
        "alcantara": material("CB_CarAlcantara", "#0f0f10", rough=0.95, spec=0.2),
        "stitch": material("CB_CarStitch", "#2fd6a5", rough=0.6),
        "screen": material("CB_CarScreen", "#050608", rough=0.05, emission="#2a6bd6", strength=1.5),
        "plate": material("CB_CarPlate", "#f1f1ee", rough=0.4),
        "exhaust": material("CB_CarExhaust", "#9a9ca0", rough=0.25, metal=1.0),
        "mint": material("CB_CarMint", "#2fd6a5", rough=0.3, emission="#2fd6a5", strength=0.4),
    }


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def mesh_obj(name, bm, col, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    if mat is not None:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def w(s, x, z):
    """Station coordinates -> Blender world."""
    return Vector((x, -s, z))


def smooth(xs, ys):
    """A smooth interpolator through a table (monotone cubic)."""
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    order = np.argsort(xs)
    xs, ys = xs[order], ys[order]
    d = np.diff(ys) / np.diff(xs)
    m = np.zeros_like(ys)
    m[1:-1] = np.where(d[:-1] * d[1:] > 0, 2 / (1 / np.where(d[:-1] == 0, 1e-9, d[:-1]) +
                                                 1 / np.where(d[1:] == 0, 1e-9, d[1:])), 0)
    m[0], m[-1] = d[0], d[-1]

    def f(x):
        x = np.clip(x, xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
    return f


def apply_modifiers(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def boolean(target, cutter, op="DIFFERENCE", solver="EXACT"):
    m = target.modifiers.new(f"bool_{cutter.name}", "BOOLEAN")
    m.object = cutter
    m.operation = op
    m.solver = solver
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def rounded_box(name, size, center, col, radius=0.02, segments=3, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = mesh_obj(name, bm, col, smooth=True)
    if radius > 0:
        bev = o.modifiers.new("bev", "BEVEL")
        bev.width = radius
        bev.segments = segments
        bev.limit_method = "NONE"
        apply_modifiers(o)
    o.rotation_euler = rot
    o.location = center
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o
