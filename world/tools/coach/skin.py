"""Skin: a Principled BSDF with random-walk skin SSS, built from masks painted
straight off the anatomy rather than a single flat colour.

Masks (point attributes, read by the shader through Attribute nodes):
  m_lips   lips vertex group, feathered
  m_red    ears, nose tip, cheeks: where blood sits close to the surface
  m_dark   knuckles, elbows, knees: where skin folds and darkens
  m_scalp  the faded sides and the hairline, shaded by stubble
  m_nails  finger and toe nails

Detail is three layers of bump at physical scale — pores (~0.4 mm cells),
fine crossing lines, and a broader skin undulation — with roughness driven
by the same noise so the sheen breaks up the way real skin does.
"""
import bpy
import numpy as np
from common import (body, bone_head, group_weights, hex_lin, landmarks, link,
                    node, rest_coords, set_point_attr)

from profile import P as _P
TONE = _P["skin"]["tone"]
_TONE_COACH = "#66412f"         # sampled from the reference, highlights excluded
TONE_RED = _P["skin"]["red"]
TONE_DARK = _P["skin"]["dark"]
TONE_LIPS = _P["skin"]["lips"]
TONE_SCALP = _P["skin"]["scalp"]
TONE_NAILS = _P["skin"]["nails"]


def gauss(co, centre, radius):
    d = np.linalg.norm(co - np.asarray(centre), axis=1)
    return np.exp(-(d / radius) ** 2)


def paint_masks(obj):
    co = rest_coords(obj)
    lips = np.clip(group_weights(obj, "lips") * 1.2, 0, 1)
    ears = group_weights(obj, "ears")
    nails = np.clip(group_weights(obj, "fingernails") + group_weights(obj, "toenails"), 0, 1)
    scalp = group_weights(obj, "scalp")

    lm = landmarks(obj)
    red = ears * 0.9 + gauss(co, lm["nose"], 0.02) * 0.7
    for side in ("l", "r"):
        # the cheek sits a little below and forward of each eye
        red += gauss(co, lm[f"eye_{side}"] + np.array([0, -0.012, -0.035]), 0.028) * 0.35
    red = np.clip(red, 0, 1)

    dark = np.zeros(len(co))
    for side in ("l", "r"):
        dark += gauss(co, bone_head(f"lowerarm_{side}"), 0.045) * 0.8
        dark += gauss(co, bone_head(f"calf_{side}"), 0.05) * 0.6
        for f in ("index", "middle", "ring", "pinky"):
            for j in ("01", "02", "03"):
                dark += gauss(co, bone_head(f"{f}_{j}_{side}"), 0.009) * 0.9
        dark += gauss(co, bone_head(f"thumb_02_{side}"), 0.01) * 0.7
    dark = np.clip(dark, 0, 1)

    set_point_attr(obj, "m_lips", lips)
    set_point_attr(obj, "m_red", red)
    set_point_attr(obj, "m_dark", dark)
    set_point_attr(obj, "m_scalp", scalp)
    set_point_attr(obj, "m_nails", nails)


def build_material():
    mat = bpy.data.materials.new("M_Skin")
    mat.use_nodes = True
    t = mat.node_tree
    t.nodes.clear()
    out = node(t, "ShaderNodeOutputMaterial", (1400, 0))
    bsdf = node(t, "ShaderNodeBsdfPrincipled", (1100, 0))
    bsdf.subsurface_method = "RANDOM_WALK_SKIN"
    bsdf.inputs["Subsurface Weight"].default_value = 0.25
    # deeper skin scatters less far and redder than pale skin
    bsdf.inputs["Subsurface Radius"].default_value = (0.8, 0.32, 0.2)
    bsdf.inputs["Subsurface Scale"].default_value = 0.004
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    bsdf.inputs["IOR"].default_value = 1.4
    link(t, bsdf.outputs[0], out.inputs[0])

    tex = node(t, "ShaderNodeTexCoord", (-1400, 0))

    def attr(name, y):
        a = node(t, "ShaderNodeAttribute", (-900, y))
        a.attribute_name = name
        a.attribute_type = "GEOMETRY"
        return a.outputs["Fac"]

    # low-frequency mottling so no two square centimetres are the same colour
    mott = node(t, "ShaderNodeTexNoise", (-900, 400), Scale=18.0, Detail=6.0, Roughness=0.6)
    link(t, tex.outputs["Object"], mott.inputs["Vector"])
    mott_c = node(t, "ShaderNodeMapRange", (-700, 400))
    mott_c.inputs["From Min"].default_value = 0.35
    mott_c.inputs["From Max"].default_value = 0.65
    mott_c.inputs["To Min"].default_value = 0.88
    mott_c.inputs["To Max"].default_value = 1.1
    link(t, mott.outputs["Fac"], mott_c.inputs["Value"])

    col = node(t, "ShaderNodeRGB", (-700, 200))
    col.outputs[0].default_value = hex_lin(TONE)
    tint = node(t, "ShaderNodeMix", (-450, 250))
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    link(t, col.outputs[0], tint.inputs["A"])
    link(t, mott_c.outputs[0], tint.inputs["B"])
    cur = tint.outputs["Result"]

    y = 0
    for mask, hexcol, amount in (("m_red", TONE_RED, 0.6), ("m_dark", TONE_DARK, 0.55),
                                 ("m_scalp", TONE_SCALP, 0.75), ("m_lips", TONE_LIPS, 0.9),
                                 ("m_nails", TONE_NAILS, 0.8)):
        m = node(t, "ShaderNodeMath", (-450, y - 200))
        m.operation = "MULTIPLY"
        link(t, attr(mask, y - 200), m.inputs[0])
        m.inputs[1].default_value = amount
        mix = node(t, "ShaderNodeMix", (-200, y - 200))
        mix.data_type = "RGBA"
        link(t, m.outputs[0], mix.inputs["Factor"])
        link(t, cur, mix.inputs["A"])
        mix.inputs["B"].default_value = hex_lin(hexcol)
        cur = mix.outputs["Result"]
        y -= 200
    link(t, cur, bsdf.inputs["Base Color"])

    # --- microdetail -------------------------------------------------------
    pores = node(t, "ShaderNodeTexVoronoi", (-900, -1300), Scale=2200.0)
    pores.feature = "DISTANCE_TO_EDGE"
    pores.inputs["Randomness"].default_value = 0.9
    link(t, tex.outputs["Object"], pores.inputs["Vector"])
    pore_pit = node(t, "ShaderNodeMapRange", (-700, -1300))
    pore_pit.inputs["From Min"].default_value = 0.0
    pore_pit.inputs["From Max"].default_value = 0.12
    link(t, pores.outputs["Distance"], pore_pit.inputs["Value"])

    lines = node(t, "ShaderNodeTexNoise", (-900, -1550), Scale=900.0, Detail=3.0)
    lines_m = node(t, "ShaderNodeMapping", (-1100, -1550))
    lines_m.inputs["Scale"].default_value = (1.0, 1.0, 6.0)   # stretched: fine lines, not blobs
    link(t, tex.outputs["Object"], lines_m.inputs["Vector"])
    link(t, lines_m.outputs[0], lines.inputs["Vector"])

    undul = node(t, "ShaderNodeTexNoise", (-900, -1800), Scale=140.0, Detail=4.0)
    link(t, tex.outputs["Object"], undul.inputs["Vector"])

    b1 = node(t, "ShaderNodeBump", (-400, -1300), Strength=0.35, Distance=0.00025)
    link(t, pore_pit.outputs[0], b1.inputs["Height"])
    b2 = node(t, "ShaderNodeBump", (-200, -1500), Strength=0.2, Distance=0.00015)
    link(t, lines.outputs["Fac"], b2.inputs["Height"])
    link(t, b1.outputs[0], b2.inputs["Normal"])
    b3 = node(t, "ShaderNodeBump", (0, -1700), Strength=0.25, Distance=0.0008)
    link(t, undul.outputs["Fac"], b3.inputs["Height"])
    link(t, b2.outputs[0], b3.inputs["Normal"])
    link(t, b3.outputs[0], bsdf.inputs["Normal"])

    # roughness: 0.42 base, oilier on the face and lips, pores break the sheen
    rough = node(t, "ShaderNodeMapRange", (600, -500))
    rough.inputs["From Min"].default_value = 0.0
    rough.inputs["From Max"].default_value = 1.0
    rough.inputs["To Min"].default_value = 0.34
    rough.inputs["To Max"].default_value = 0.55
    link(t, undul.outputs["Fac"], rough.inputs["Value"])
    lipr = node(t, "ShaderNodeMix", (850, -500))
    lipr.data_type = "FLOAT"
    link(t, attr("m_lips", -700), lipr.inputs["Factor"])
    link(t, rough.outputs[0], lipr.inputs["A"])
    lipr.inputs["B"].default_value = 0.42
    nailr = node(t, "ShaderNodeMix", (1000, -600))
    nailr.data_type = "FLOAT"
    link(t, attr("m_nails", -900), nailr.inputs["Factor"])
    link(t, lipr.outputs["Result"], nailr.inputs["A"])
    nailr.inputs["B"].default_value = 0.2
    link(t, nailr.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def apply():
    obj = body()
    paint_masks(obj)
    mat = build_material()
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    sub = obj.modifiers.get("Subdiv") or obj.modifiers.new("Subdiv", "SUBSURF")
    sub.levels, sub.render_levels = 1, 2
    return mat
