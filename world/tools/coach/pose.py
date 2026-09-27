"""The reference pose: standing, arms crossed, weight settled on one leg.

Hands are placed where they are in the photograph — each tucked under the
opposite bicep, his left forearm in front of and a little below his right —
and the elbows are solved by IK toward poles out to the side and forward,
then baked into plain bone rotations so nothing depends on constraints.

The arms must actually meet: the forearm stack is set from the measured arm
thickness, so the front forearm rests on the back one rather than floating
or passing through it.
"""
import bpy, math
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector
from common import bone_head, body, group_weights, rest_coords, rig


def arm_thickness(bone):
    co = rest_coords(body())
    w = group_weights(body(), bone) > 0.6
    h, t = np.array(bone_head(bone)), np.array(bone_head(bone, tail=True))
    ax = (t - h) / np.linalg.norm(t - h)
    rel = co[w] - h
    radial = rel - np.outer(rel @ ax, ax)
    return float(np.percentile(np.linalg.norm(radial, axis=1), 90))


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    return e


def rotate(pb, axis, deg, space="LOCAL"):
    pb.rotation_mode = "QUATERNION"
    q = Quaternion(Vector(axis), math.radians(deg))
    pb.rotation_quaternion = pb.rotation_quaternion @ q


def rotate_world(pb, axis, deg):
    """Rotate a pose bone about a world-space axis (through its head)."""
    r = rig()
    rest = (r.matrix_world @ pb.bone.matrix_local).to_3x3()
    local_axis = rest.inverted() @ Vector(axis)
    rotate(pb, local_axis.normalized(), deg)


def bake(r, names):
    """Replace constraint results with plain transforms, parent before child."""
    bpy.context.view_layer.update()
    mats = {n: r.pose.bones[n].matrix.copy() for n in names}
    for n in names:
        for c in list(r.pose.bones[n].constraints):
            r.pose.bones[n].constraints.remove(c)
    for n in names:
        r.pose.bones[n].matrix = mats[n]
        bpy.context.view_layer.update()


def apply():
    r = rig()
    bpy.context.view_layer.objects.active = r
    for pb in r.pose.bones:
        pb.rotation_mode = "QUATERNION"

    co = rest_coords(body())
    chest_front = co[:, 1][(co[:, 2] > bone_head("spine_03").z - 0.05)
                           & (co[:, 2] < bone_head("spine_03").z + 0.1)
                           & (np.abs(co[:, 0]) < 0.08)].min()
    s_l, s_r = bone_head("upperarm_l"), bone_head("upperarm_r")
    fore = arm_thickness("lowerarm_l")
    bicep = arm_thickness("upperarm_l")
    print(f"POSE chest_front={chest_front:.3f} forearm_r={fore:.3f} bicep_r={bicep:.3f}")

    # --- body: shoulders roll forward, a slight weight shift, the head's tilt
    rotate(r.pose.bones["clavicle_l"], (0, 0, 1), -6)
    rotate(r.pose.bones["clavicle_r"], (0, 0, 1), 6)
    rotate(r.pose.bones["pelvis"], (0, 1, 0), 2.0)
    rotate(r.pose.bones["spine_02"], (0, 1, 0), -1.5)
    rotate(r.pose.bones["neck_01"], (1, 0, 0), 4)
    rotate(r.pose.bones["head"], (0, 1, 0), -4)
    rotate(r.pose.bones["head"], (1, 0, 0), 3)
    rotate(r.pose.bones["calf_r"], (1, 0, 0), 4)
    # MakeHuman stands with the ankles 40 cm apart; bring them in to a relaxed
    # stance, his right foot turned out a touch, and keep the soles flat
    for side, sign, deg in (("l", 1, 3.2), ("r", -1, 4.0)):
        rotate_world(r.pose.bones[f"thigh_{side}"], (0, 1, 0), deg * sign)
        rotate_world(r.pose.bones[f"foot_{side}"], (0, 1, 0), -deg * sign)
    rotate_world(r.pose.bones["thigh_r"], (0, 0, 1), -6)
    bpy.context.view_layer.update()

    # --- elbows and wrists, placed directly in world space
    # Upper arms hang down and forward with the elbows at the deltoids' width;
    # forearms run across, his right one higher and against the chest, his left
    # one lower and in front of it, stacked by the measured forearm thickness.
    def length(bone):
        return (bone_head(bone, tail=True) - bone_head(bone)).length

    lu, lf = length("upperarm_l"), length("lowerarm_l")
    out = {"l": Vector((1, 0, 0)), "r": Vector((-1, 0, 0))}
    fwd, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    plan = {
        "r": dict(elbow_dir=(out["r"] * 0.12 + fwd * 0.64 - up * 0.72),
                  fore_dir=(-out["r"] * 1.0 - fwd * 0.1 + up * 0.14)),
        "l": dict(elbow_dir=(out["l"] * 0.16 + fwd * 0.82 - up * 0.56),
                  fore_dir=(-out["l"] * 1.0 + fwd * 0.02 + up * 0.2)),
    }
    made = []
    for side, p in plan.items():
        s = bone_head(f"upperarm_{side}") if False else (
            r.matrix_world @ r.pose.bones[f"upperarm_{side}"].head)
        e = s + p["elbow_dir"].normalized() * lu
        w = e + p["fore_dir"].normalized() * lf
        te = empty(f"T_elbow_{side}", e)
        tw = empty(f"T_wrist_{side}", w)
        made += [te, tw]
        c = r.pose.bones[f"upperarm_{side}"].constraints.new("DAMPED_TRACK")
        c.target, c.track_axis = te, "TRACK_Y"
        c = r.pose.bones[f"lowerarm_{side}"].constraints.new("DAMPED_TRACK")
        c.target, c.track_axis = tw, "TRACK_Y"
    bake(r, ["upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"])

    # the hands bend back at the wrist and disappear under the opposite bicep
    for side in ("l", "r"):
        wr = r.matrix_world @ r.pose.bones[f"hand_{side}"].head
        fore = (wr - (r.matrix_world @ r.pose.bones[f"lowerarm_{side}"].head)).normalized()
        tuck = (fore * 0.55 - fwd * 0.8).normalized()
        th = empty(f"T_hand_{side}", wr + tuck * 0.1)
        made.append(th)
        c = r.pose.bones[f"hand_{side}"].constraints.new("DAMPED_TRACK")
        c.target, c.track_axis = th, "TRACK_Y"
    bake(r, ["hand_l", "hand_r"])
    for e in made:
        bpy.data.objects.remove(e, do_unlink=True)

    # --- wrists: palms turn in to the arm they grip, the hand follows the forearm
    for side, sign in (("l", 1), ("r", -1)):
        # fingers wrap round the opposite arm; each joint curls a little more
        for f, base in (("index", 38), ("middle", 42), ("ring", 46), ("pinky", 50)):
            for j, k in (("01", 1.0), ("02", 1.25), ("03", 0.9)):
                rotate(r.pose.bones[f"{f}_{j}_{side}"], (0, 0, 1), base * k * sign)
        # the thumb lies along the top of the bicep
        rotate(r.pose.bones[f"thumb_01_{side}"], (0, 0, 1), 15 * sign)
        rotate(r.pose.bones[f"thumb_02_{side}"], (0, 0, 1), 12 * sign)
    bpy.context.view_layer.update()

    for side in ("l", "r"):
        e = r.pose.bones[f"lowerarm_{side}"].head
        w = r.matrix_world @ r.pose.bones[f"hand_{side}"].head
        print(f"POSE {side}: elbow={tuple(round(x, 3) for x in (r.matrix_world @ e))} "
              f"wrist={tuple(round(x, 3) for x in w)}")
