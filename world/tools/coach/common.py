"""Shared helpers for the Coach Blue hero build (run inside Blender)."""
import bpy
import numpy as np
from mathutils import Vector


def collection(name, parent=None):
    """Get or create a collection, linked under `parent` (or the scene root)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def move_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def body():
    return bpy.data.objects["CB_Body"]


def rig():
    return bpy.data.objects["CB_Rig"]


def rest_coords(obj):
    """World-space vertex positions of the shaped body, before any armature pose."""
    dg = bpy.context.evaluated_depsgraph_get()
    mods = [(m, m.show_viewport) for m in obj.modifiers if m.type in ("ARMATURE", "MASK", "SUBSURF")]
    for m, _ in mods:
        m.show_viewport = False
    dg.update()
    ev = obj.evaluated_get(dg)
    co = np.empty(len(ev.data.vertices) * 3)
    ev.data.vertices.foreach_get("co", co)
    for m, v in mods:
        m.show_viewport = v
    co = co.reshape(-1, 3)
    mw = np.array(obj.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]


def group_weights(obj, name):
    """Per-vertex weight array for one vertex group (0 where unassigned)."""
    g = obj.vertex_groups.get(name)
    w = np.zeros(len(obj.data.vertices))
    if g is None:
        return w
    gi = g.index
    for v in obj.data.vertices:
        for e in v.groups:
            if e.group == gi:
                w[v.index] = e.weight
    return w


def bone_head(name, tail=False):
    r = rig()
    b = r.data.bones[name]
    return r.matrix_world @ (b.tail_local if tail else b.head_local)


def set_point_attr(obj, name, values):
    mesh = obj.data
    if name in mesh.attributes:
        mesh.attributes.remove(mesh.attributes[name])
    a = mesh.attributes.new(name, "FLOAT", "POINT")
    a.data.foreach_set("value", np.asarray(values, dtype=np.float32))


def node(tree, kind, loc=(0, 0), **inputs):
    n = tree.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def link(tree, a, b):
    tree.links.new(a, b)


def hex_lin(h):
    """sRGB hex -> linear RGBA."""
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, 1.0)


def landmarks(obj=None):
    """Face landmarks measured off the shaped mesh, in world space."""
    obj = obj or body()
    co = rest_coords(obj)
    head = group_weights(obj, "head") > 0.5
    helpers = group_weights(obj, "HelperGeometry") > 0.5
    face = head & ~helpers
    idx = np.where(face)[0]
    nose = co[idx[np.argmin(co[idx, 1])]]
    out = {"nose": nose}
    for side in ("l", "r"):
        e = co[group_weights(obj, f"helper-{side}-eye") > 0.5]
        c = e.mean(axis=0)
        out[f"eye_{side}"] = c
        out[f"eye_{side}_radius"] = float(np.linalg.norm(e - c, axis=1).max())
    top = co[idx[np.argmax(co[idx, 2])]]
    out["crown"] = top
    return out
