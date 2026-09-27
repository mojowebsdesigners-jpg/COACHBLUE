"""Generate the gym's clients as real, distinct human bodies with MPFB2/MakeHuman.

    blender -b -P tools/people.py -- <out_dir> [assets_dir]

MPFB2 is MakeHuman as a Blender add-on: a parametric human where sex, age,
build, weight, height and proportions are continuous sliders over a scanned
base mesh. That is the one thing a mesh generator cannot do — three people who
are actually built differently rather than one body at three scales.

Each character is exported as a static T-pose GLB. Rigging is left to
tools/rig.py, which fits the real Mixamo skeleton to the mesh so the existing
idle/walk/run clips apply unchanged.

Note this script must NOT run with --factory-startup: it needs the installed
add-on.
"""
import bpy, importlib, json, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
ASSETS = argv[1] if len(argv) > 1 else None
# optional third argument: build only these characters, comma separated
ONLY = set(argv[2].split(",")) if len(argv) > 2 and argv[2] else None
os.makedirs(OUT, exist_ok=True)


def dynamic_import(package_suffix, key):
    """Blender extensions land at an unpredictable point in the module tree."""
    for name in sys.modules:
        if name.endswith(package_suffix):
            mod = importlib.import_module(name)
            if hasattr(mod, key):
                return getattr(mod, key)
    raise ValueError(f"no module ending in {package_suffix} exposing {key}")


HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")
ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
HumanObjectProperties = dynamic_import("mpfb.entities.objectproperties", "HumanObjectProperties")
try:
    AssetService = dynamic_import("mpfb.services.assetservice", "AssetService")
except Exception:
    AssetService = None

# In MakeHuman's macro space the sliders run 0..1 and 0.5 is the neutral middle,
# so "gender 0.15" is emphatically female and "0.9" emphatically male. Age,
# muscle and weight work the same way.
PEOPLE = [
    {
        # Coach Blue himself, matched to the photographs on coach-blue.com:
        # heavily muscled, mixed complexion, short faded hair, and the dark navy
        # cargo trousers he is actually photographed in.
        "name": "coach-mh",
        "note": "Coach Blue — muscular, military bearing",
        "macros": {"gender": 0.97, "age": 0.44, "muscle": 1.0, "weight": 0.7,
                   "height": 0.52, "proportions": 0.7,
                   "african": 0.5, "asian": 0.15, "caucasian": 0.35},
        "skin": "young_african_male.mhmat",
        # casualsuit06 is the pack's only plain short-sleeve tee for a man, and
        # bare arms are the whole point on someone who coaches for a living
        "wear": [("clothes", "male_casualsuit06.mhclo", "Clothes"),
                 ("clothes", "shoes01.mhclo", "Clothes"),
                 ("hair", "short02.mhclo", "Hair"),
                 ("eyes", "low-poly.mhclo", "Eyes")],
    },
    {
        "name": "client-a",
        "note": "woman, lean and athletic",
        "macros": {"gender": 0.08, "age": 0.42, "muscle": 0.66, "weight": 0.44,
                   "height": 0.44, "proportions": 0.6, "cupsize": 0.35, "firmness": 0.7,
                   "african": 0.25, "asian": 0.15, "caucasian": 0.6},
        "skin": "young_caucasian_female2.mhmat",
        "wear": [("clothes", "female_sportsuit01.mhclo", "Clothes"),
                 ("clothes", "shoes05.mhclo", "Clothes"),
                 ("hair", "ponytail01.mhclo", "Hair"),
                 ("eyes", "low-poly.mhclo", "Eyes")],
    },
    {
        "name": "client-b",
        "note": "man, tall and light-framed",
        "macros": {"gender": 0.94, "age": 0.35, "muscle": 0.58, "weight": 0.38,
                   "height": 0.78, "proportions": 0.62,
                   "african": 0.6, "asian": 0.1, "caucasian": 0.3},
        "skin": "young_african_male.mhmat",
        "wear": [("clothes", "male_casualsuit03.mhclo", "Clothes"),
                 ("clothes", "shoes01.mhclo", "Clothes"),
                 ("hair", "short02.mhclo", "Hair"),
                 ("eyes", "low-poly.mhclo", "Eyes")],
    },
    {
        "name": "client-c",
        "note": "man, shorter and heavier set",
        "macros": {"gender": 0.96, "age": 0.62, "muscle": 0.74, "weight": 0.68,
                   "height": 0.36, "proportions": 0.45,
                   "african": 0.1, "asian": 0.35, "caucasian": 0.55},
        "skin": "young_caucasian_male.mhmat",
        "wear": [("clothes", "male_casualsuit05.mhclo", "Clothes"),
                 ("clothes", "shoes03.mhclo", "Clothes"),
                 ("hair", "short04.mhclo", "Hair"),
                 ("eyes", "low-poly.mhclo", "Eyes")],
    },
]


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


made = []
for spec in PEOPLE:
    if ONLY and spec["name"] not in ONLY:
        continue
    clear()
    human = HumanService.create_human()
    for key, value in spec["macros"].items():
        try:
            HumanObjectProperties.set_value(key, value, entity_reference=human)
        except Exception as exc:
            print("SKIP MACRO", key, exc)
    TargetService.reapply_macro_details(human)

    # skin, when the CC0 asset pack is available. GAMEENGINE keeps the material
    # to a single Principled BSDF, which is what glTF can carry.
    if ASSETS and AssetService:
        try:
            path = AssetService.find_asset_absolute_path(spec["skin"], asset_subdir="skins")
            if path:
                HumanService.set_character_skin(path, human, skin_type="GAMEENGINE")
                print("SKIN", spec["name"], os.path.basename(path))
            else:
                print("NO SKIN FOUND", spec["skin"])
        except Exception as exc:
            print("SKIN FAIL", exc)

    # kit: the CC0 pack's own garments, fitted to this body's proportions
    if ASSETS and AssetService:
        for subdir, fname, atype in spec.get("wear", []):
            try:
                path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
                if not path:
                    print("NO ASSET", fname)
                    continue
                HumanService.add_mhclo_asset(path, human, asset_type=atype,
                                             material_type="GAMEENGINE")
                print("WEAR", spec["name"], fname)
            except Exception as exc:
                print("WEAR FAIL", fname, exc)

    # MakeHuman carries invisible helper geometry for fitting clothes; bake it
    # out or it exports as a second shell around the body
    root = ExportService.create_character_copy(human, name_suffix="_export")
    mesh = ObjectService.find_object_of_type_amongst_nearest_relatives(root, "Basemesh")
    ExportService.bake_modifiers_remove_helpers(
        mesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)

    # select the exported copy and everything parented under it (clothes, hair,
    # eyes), leaving the original character in the scene untouched
    bpy.ops.object.select_all(action="DESELECT")
    def pick(obj):
        if obj.type in ("MESH", "ARMATURE"):
            obj.select_set(True)
        for child in obj.children:
            pick(child)
    pick(root)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    path = os.path.join(OUT, f"{spec['name']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True,
        use_selection=True, export_apply=True, export_animations=False)
    dims = tuple(round(d, 3) for d in mesh.dimensions)
    print(f"WROTE {path} verts={len(mesh.data.vertices)} dims={dims}  # {spec['note']}")
    made.append({"name": spec["name"], "note": spec["note"], "dims": dims})

json.dump(made, open(os.path.join(OUT, "people.json"), "w"), indent=2)
print("DONE", len(made))
