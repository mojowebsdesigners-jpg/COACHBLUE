"""Export the coupe for the game.

Static geometry (shell, glass, lamps, trim, cabin) is joined into one mesh so
it costs one draw call per material rather than one per part. What the game
animates or reads stays separate and named:

  Car                      root, origin on the ground between the axles, +Z forward
    CarBody                everything static
    Wheel_{F,R}{L,R}       steer pivots at the hubs
      ..._Spin             tyre + rim + disc, spins about local X
      Caliper_..           stays with the pivot
    SteeringWheel          turns about its local +Y (Blender Z)
      Grip_L / Grip_R      nine and three o'clock
    Seat_Driver, Pedals, Door_Driver, Lamp_Head_{L,R}, Lamp_Tail_{L,R}
    DoorHinge_L            the driver's door swings open about its local +Y
      DoorPanel_L          the door skin, its window, handle and door card
"""
import bpy, math
from mathutils import Vector
from common import apply_modifiers, w

KEEP = ("Wheel_", "Caliper_", "SteeringWheel", "Grip_", "Seat_Driver", "Pedals", "Door_Driver", "DoorHinge", "DoorPanel")

# the driver's door (+X), between the two shut-line slots body.py cuts:
# front edge s ~0.65, rear edge s ~-0.8, up to the shoulder line
DOOR_S = (-0.8, 0.645)


def take_faces(obj, test, name):
    """Split the faces whose centre passes `test(s, x, z)` off into a new object."""
    import bmesh
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    mw = obj.matrix_world
    n = 0
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        f.select = test(-c.y, c.x, c.z)
        n += f.select
    bmesh.update_edit_mesh(obj.data)
    if n == 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        return None
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    part = [o for o in bpy.context.selected_objects if o is not obj][0]
    part.name = name
    return part


def make_door(car_col):
    """Cut the driver's door out of the shell and hang it on a hinge."""
    from body import zsh
    body = bpy.data.objects["Body"]
    s0, s1 = DOOR_S
    parts = [take_faces(body, lambda s, x, z: x > 0.3 and s0 < s < s1 and 0.17 < z < float(zsh(s)) + 0.055,
                        "DoorSkin_L")]
    glass = bpy.data.objects.get("Glass")
    if glass:
        parts.append(take_faces(glass, lambda s, x, z: x > 0.3 and s0 + 0.05 < s < s1 - 0.04 and z > 0.6,
                                "DoorGlass_L"))
    for n in ("Handle_1", "DoorCard_1", "DoorArm_1", "DoorStrip_1"):
        if n in bpy.data.objects:
            parts.append(bpy.data.objects[n])
    parts = [p for p in parts if p]
    for p in parts:
        if p.modifiers:
            apply_modifiers(p)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    panel = bpy.context.active_object
    panel.name = "DoorPanel_L"
    # the hinge line runs down the door's front edge, just inside the skin
    from body import hw
    hinge = bpy.data.objects.new("DoorHinge_L", None)
    car_col.objects.link(hinge)
    hinge.location = w(s1 - 0.02, float(hw(s1)) - 0.03, 0.55)
    bpy.context.view_layer.update()
    mw = panel.matrix_world.copy()
    panel.parent = hinge
    panel.matrix_world = mw
    print("DOOR faces", len(panel.data.polygons))


def run(path, ctx):
    scene = bpy.context.scene
    car_col = bpy.data.collections["CAR"]
    # lamp anchors for the game's real lights
    for name, loc in (("Lamp_Head_L", w(2.1, 0.64, 0.66)), ("Lamp_Head_R", w(2.1, -0.64, 0.66)),
                      ("Lamp_Tail_L", w(-2.22, 0.72, 0.85)), ("Lamp_Tail_R", w(-2.22, -0.72, 0.85))):
        e = bpy.data.objects.new(name, None)
        car_col.objects.link(e)
        e.location = loc

    body = bpy.data.objects["Body"]
    dec = body.modifiers.new("web", "DECIMATE")
    dec.ratio = 0.5
    apply_modifiers(body)
    make_door(car_col)

    static = [o for o in car_col.objects if o.type == "MESH" and not o.name.startswith(KEEP)
              and o.parent is None]
    # anything still carrying a modifier (bevels, arrays) gets it baked in first
    for o in static:
        if o.modifiers:
            apply_modifiers(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in static:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "CarBody"

    root = bpy.data.objects.new("Car", None)
    car_col.objects.link(root)
    for o in list(car_col.objects):
        if o is root or o.parent is not None:
            continue
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = mw

    bpy.ops.object.select_all(action="DESELECT")
    for o in car_col.all_objects:
        o.select_set(True)
    verts = sum(len(o.data.vertices) for o in car_col.all_objects if o.type == "MESH")
    print(f"EXPORT objects={len(car_col.all_objects)} verts={verts}")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_animations=False,
                              export_extras=False)
    print("WROTE", path)
