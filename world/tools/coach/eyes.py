"""Eyes: separate eyeball and cornea geometry fitted to MPFB's eye helpers.

The eyeball carries sclera, limbal ring, iris and pupil in one shader, driven
by the angle off the eye's forward axis. The iris is recessed slightly behind
a clear cornea bulge, so the cornea refracts it and catches highlights the way
a real eye does — the iris is never simply painted onto the front of a ball.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector
from common import collection, hex_lin, landmarks, link, move_to, node, rig

from profile import P as _P
IRIS_HEX = _P["iris"]
SCLERA_HEX = "#e9dcd2"


def eyeball_material():
    mat = bpy.data.materials.new("M_Eye")
    mat.use_nodes = True
    t = mat.node_tree
    t.nodes.clear()
    out = node(t, "ShaderNodeOutputMaterial", (1200, 0))
    bsdf = node(t, "ShaderNodeBsdfPrincipled", (900, 0))
    link(t, bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Roughness"].default_value = 0.3
    bsdf.inputs["Subsurface Weight"].default_value = 0.15
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.4, 0.3)
    bsdf.inputs["Subsurface Scale"].default_value = 0.002

    # object space: origin at the eye centre, local -Y looks forward, radius 1
    tc = node(t, "ShaderNodeTexCoord", (-1400, 0))
    sep = node(t, "ShaderNodeSeparateXYZ", (-1200, 0))
    link(t, tc.outputs["Object"], sep.inputs[0])
    # r = distance from the forward axis, normalised to the ball's radius
    r2 = node(t, "ShaderNodeVectorMath", (-1200, -200))
    r2.operation = "MULTIPLY"
    link(t, tc.outputs["Object"], r2.inputs[0])
    r2.inputs[1].default_value = (1, 0, 1)
    rlen = node(t, "ShaderNodeVectorMath", (-1000, -200))
    rlen.operation = "LENGTH"
    link(t, r2.outputs[0], rlen.inputs[0])
    front = node(t, "ShaderNodeMath", (-1000, 50))
    front.operation = "LESS_THAN"
    link(t, sep.outputs["Y"], front.inputs[0])
    front.inputs[1].default_value = 0.0
    r = node(t, "ShaderNodeMath", (-800, -200))   # r on the front, 1 on the back
    r.operation = "MAXIMUM"
    inv = node(t, "ShaderNodeMath", (-900, 0))
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    link(t, front.outputs[0], inv.inputs[1])
    link(t, rlen.outputs[1], r.inputs[0])
    link(t, inv.outputs[0], r.inputs[1])

    ramp = node(t, "ShaderNodeValToRGB", (-500, 200))
    link(t, r.outputs[0], ramp.inputs[0])
    cr = ramp.color_ramp
    cr.interpolation = "EASE"
    stops = [(0.0, "#050302"), (0.13, "#070403"), (0.15, IRIS_HEX), (0.36, "#5a3520"),
             (0.43, "#2a160c"), (0.47, "#1a0e08"), (0.5, "#b9a79b"), (1.0, SCLERA_HEX)]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], hex_lin(stops[0][1])
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], hex_lin(stops[-1][1])
    for pos, h in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = hex_lin(h)

    # iris fibres: radial streaks, only inside the iris band
    fib = node(t, "ShaderNodeTexWave", (-700, 500), Scale=3.0, Distortion=6.0, Detail=4.0)
    fib.wave_type = "RINGS"
    fib.rings_direction = "SPHERICAL"
    link(t, tc.outputs["Object"], fib.inputs["Vector"])
    fibn = node(t, "ShaderNodeTexNoise", (-700, 700), Scale=40.0, Detail=8.0)
    link(t, tc.outputs["Object"], fibn.inputs["Vector"])
    iris_band = node(t, "ShaderNodeMapRange", (-500, 600))
    link(t, r.outputs[0], iris_band.inputs["Value"])
    iris_band.inputs["From Min"].default_value = 0.47
    iris_band.inputs["From Max"].default_value = 0.44
    fmix = node(t, "ShaderNodeMix", (-200, 450))
    fmix.data_type = "RGBA"
    fmix.blend_type = "OVERLAY"
    fmul = node(t, "ShaderNodeMath", (-300, 650))
    fmul.operation = "MULTIPLY"
    link(t, iris_band.outputs[0], fmul.inputs[0])
    fmul.inputs[1].default_value = 0.6
    link(t, fmul.outputs[0], fmix.inputs["Factor"])
    link(t, ramp.outputs[0], fmix.inputs["A"])
    link(t, fibn.outputs["Color"], fmix.inputs["B"])

    # sclera veins: thin distorted lines that fade in away from the iris
    veins = node(t, "ShaderNodeTexWave", (-700, 950), Scale=5.0, Distortion=14.0,
                 Detail=6.0, **{"Detail Scale": 3.0})
    link(t, tc.outputs["Object"], veins.inputs["Vector"])
    vthin = node(t, "ShaderNodeMapRange", (-500, 950))
    link(t, veins.outputs["Fac"], vthin.inputs["Value"])
    vthin.inputs["From Min"].default_value = 0.93
    vthin.inputs["From Max"].default_value = 1.0
    vzone = node(t, "ShaderNodeMapRange", (-500, 1150))
    link(t, r.outputs[0], vzone.inputs["Value"])
    vzone.inputs["From Min"].default_value = 0.6
    vzone.inputs["From Max"].default_value = 1.0
    vamt = node(t, "ShaderNodeMath", (-300, 1000))
    vamt.operation = "MULTIPLY"
    link(t, vthin.outputs[0], vamt.inputs[0])
    link(t, vzone.outputs[0], vamt.inputs[1])
    vamt2 = node(t, "ShaderNodeMath", (-150, 1000))
    vamt2.operation = "MULTIPLY"
    link(t, vamt.outputs[0], vamt2.inputs[0])
    vamt2.inputs[1].default_value = 0.5
    vmix = node(t, "ShaderNodeMix", (100, 500))
    vmix.data_type = "RGBA"
    link(t, vamt2.outputs[0], vmix.inputs["Factor"])
    link(t, fmix.outputs["Result"], vmix.inputs["A"])
    vmix.inputs["B"].default_value = hex_lin("#a4463c")
    link(t, vmix.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def cornea_material():
    mat = bpy.data.materials.new("M_Cornea")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1, 1, 1, 1)
    b.inputs["Transmission Weight"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.02
    b.inputs["IOR"].default_value = 1.376
    b.inputs["Alpha"].default_value = 1.0
    # Eevee: let the raytraced refraction see through it instead of shading opaque
    mat.surface_render_method = "DITHERED"
    mat.use_raytrace_refraction = True
    return mat


def make_eye(name, centre, radius, forward, eye_mat, cornea_mat, col):
    # eyeball: slightly flattened at the front so the iris sits recessed
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1.0)
    ball = bpy.context.active_object
    ball.name = f"CB_Eye_{name}"
    for v in ball.data.vertices:
        if v.co.y < -0.9:
            v.co.y = -0.9 - (v.co.y + 0.9) * 0.3
    ball.data.materials.append(eye_mat)

    # cornea: a clear shell with a bulge over the iris
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1.0)
    cor = bpy.context.active_object
    cor.name = f"CB_Cornea_{name}"
    for v in cor.data.vertices:
        d = v.co.normalized()
        bulge = max(0.0, -d.y - 0.75) / 0.25        # 0 at the limbus, 1 at the apex
        v.co = d * (1.012 + 0.09 * bulge ** 1.5)
    cor.data.materials.append(cornea_mat)

    for o in (ball, cor):
        for p in o.data.polygons:
            p.use_smooth = True
        o.scale = (radius,) * 3
        # local -Y must point along `forward`
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(Vector(forward))
        o.location = Vector(centre)
        move_to(o, col)
    return ball, cor


def apply():
    lm = landmarks()
    head_col = collection("HEAD", collection("GAME_MESH"))
    eye_mat, cornea_mat = eyeball_material(), cornea_material()
    r = rig()
    made = []
    for side in ("l", "r"):
        c = lm[f"eye_{side}"]
        # MakeHuman eyes gaze straight ahead with a touch of outward splay
        fwd = Vector((0.04 if side == "l" else -0.04, -1, 0)).normalized()
        if side == "r":
            fwd.x = -abs(fwd.x) if c[0] < 0 else abs(fwd.x)
        else:
            fwd.x = abs(fwd.x) if c[0] > 0 else -abs(fwd.x)
        for o in make_eye(side.upper(), c, lm[f"eye_{side}_radius"] * 0.98, fwd,
                          eye_mat, cornea_mat, head_col):
            bpy.context.view_layer.update()
            mw = o.matrix_world.copy()
            o.parent = r
            o.parent_type = "BONE"
            o.parent_bone = "head"
            o.matrix_world = mw
            made.append(o)
    return made
