"""The COACH BLUE letters you can drive into, as chunky bevelled solids.

    blender -b --factory-startup -P tools/letters/build.py -- raw/letters.glb

Each letter is its own object (Letter_0_C ... Letter_8_E), set in Barlow
Condensed Bold (the site's display face), extruded deep and bevelled so the
edges catch the light, with its origin at the middle of its base so it
stands and tumbles naturally. Heights are real: 1.8 m tall letters.
"""
import bpy, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])
FONT = os.path.abspath("public/fonts/BarlowCondensed-Bold.ttf")
bpy.ops.wm.read_factory_settings(use_empty=True)
font = bpy.data.fonts.load(FONT)

made = []
for i, ch in enumerate("COACHBLUE"):
    cu = bpy.data.curves.new(f"L{i}", "FONT")
    cu.body = ch
    cu.font = font
    cu.size = 2.45            # cap height comes out at about 1.8 m
    cu.extrude = 0.22         # 0.44 m deep
    cu.bevel_depth = 0.035
    cu.bevel_resolution = 3
    cu.resolution_u = 6
    ob = bpy.data.objects.new(f"Letter_{i}_{ch}", cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.active_object
    # stand it up: text is laid in XY; the letter's face should look along -Y
    ob.rotation_euler = (1.5708, 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    # origin at the middle of the base
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    off = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs))
    for v in ob.data.vertices:
        v.co.x -= off[0]; v.co.y -= off[1]; v.co.z -= off[2]
    for p in ob.data.polygons:
        p.use_smooth = False
    ob.select_set(False)
    ob.location = (i * 1.3, 0, 0)
    made.append(ob)
    print("LETTER", ob.name, round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2), len(ob.data.polygons))

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True)
print("WROTE", OUT)
