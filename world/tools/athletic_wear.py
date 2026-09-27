"""Turn the CC0 wardrobe into gym kit, and get the textures down to web size.

    python tools/athletic_wear.py <in.glb> <out.glb> <top_hex> <leg_hex> [hair_hex]

The MakeHuman asset pack dresses its characters for the street: striped shirts,
jeans, a casual jacket. In a gym that reads as wrong more loudly than a low
polygon count does. Rather than model new garments, this re-tones the existing
ones: each garment's colour is thrown away and rebuilt from its own shading, so
every seam, fold and hem survives while the cloth becomes plain technical
fabric. Skin, eyes and hair are left alone apart from being resized.

The shading is separated with a high-pass — dividing the garment by a blurred
copy of itself, so a broad area like a stripe or a logo divides away while a
thin one like a hem survives. That blur has to be told where the garment
actually is: a MakeHuman texture is an atlas with dead space between the UV
islands, and an ordinary blur drags that background across every island edge,
printing a blocky patchwork onto the cloth. So the islands are rasterised from
the mesh's own UVs first and the blur is normalised against that mask.
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, gaussian_filter

IN, OUT = sys.argv[1], sys.argv[2]
TOP = sys.argv[3] if len(sys.argv) > 3 else "#2f3438"
LEG = sys.argv[4] if len(sys.argv) > 4 else "#1b1e21"
HAIR = sys.argv[5] if len(sys.argv) > 5 else None

SKIN_MAX = 1024        # the face is the only place detail is ever noticed
GARMENT_MAX = 512
OTHER_MAX = 512

CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
      5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64)


def read_glb(path):
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", d[off:off + 4])[0]
    return j, d[off + 8:off + 8 + bl]


def accessor(j, bin_, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    c, sz = CT[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    stride = bv.get("byteStride") or sz * nc
    out = np.empty((a["count"], nc), np.float64)
    fmt = "<" + str(nc) + c
    for k in range(a["count"]):
        out[k] = struct.unpack_from(fmt, bin_, start + k * stride)
    if a.get("normalized"):
        out = out / {"B": 255.0, "H": 65535.0, "b": 127.0, "h": 32767.0}[c]
    return out if nc > 1 else out[:, 0]


def write_glb(j, views, path):
    out = bytearray()
    for i, bv in enumerate(j["bufferViews"]):
        data = views[i]
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    while len(out) % 4:
        out.append(0)
    j["buffers"] = [{"byteLength": len(out)}]
    js = json.dumps(j, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    glb = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(out))
    glb += struct.pack("<I", len(js)) + b"JSON" + js
    glb += struct.pack("<I", len(out)) + b"BIN\x00" + bytes(out)
    open(path, "wb").write(glb)
    return len(glb)


def fit(img, longest):
    if max(img.size) <= longest:
        return img
    scale = longest / max(img.size)
    return img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)


def uv_mask(j, bin_, prims, w, h):
    """Rasterise these primitives' UV islands, so we know where cloth actually is."""
    mask = np.zeros((h, w), bool)
    for prim in prims:
        if "TEXCOORD_0" not in prim["attributes"] or "indices" not in prim:
            continue
        uv = accessor(j, bin_, prim["attributes"]["TEXCOORD_0"])
        idx = accessor(j, bin_, prim["indices"]).astype(int)
        px = uv[:, 0] * w
        py = uv[:, 1] * h
        for a, b, c in idx.reshape(-1, 3):
            xs = px[[a, b, c]]
            ys = py[[a, b, c]]
            x0 = max(int(np.floor(xs.min())), 0)
            x1 = min(int(np.ceil(xs.max())) + 1, w)
            y0 = max(int(np.floor(ys.min())), 0)
            y1 = min(int(np.ceil(ys.max())) + 1, h)
            if x1 <= x0 or y1 <= y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
            if abs(d) < 1e-9:
                continue
            l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
            l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
            hit = (l0 > -0.02) & (l1 > -0.02) & (1 - l0 - l1 > -0.02)
            if hit.any():
                ry, rx = np.nonzero(hit)
                mask[y0 + ry, x0 + rx] = True
    return mask


def technical_fabric(img, colour, mask):
    """Rebuild a garment in one flat cloth colour, keeping only its stitching."""
    a = np.array(img.convert("RGBA"), np.float64)
    rgb, alpha = a[..., :3], a[..., 3:]
    lum = rgb.mean(2)

    if mask is None or not mask.any():
        mask = np.ones(lum.shape, bool)
    m = mask.astype(np.float64)
    sigma = max(6.0, min(img.size) / 9.0)
    # normalised convolution: blur the cloth against itself, never against the
    # dead space around it
    lo = gaussian_filter(lum * m, sigma) / np.maximum(gaussian_filter(m, sigma), 1e-4)
    shade = np.clip(lum / np.maximum(lo, 1e-3), 0.86, 1.16)[..., None]

    grain = gaussian_filter(np.random.default_rng(4).normal(0, 1, lum.shape), 0.8) * 0.035
    out = np.clip(colour[None, None, :] * shade * (1 + grain)[..., None], 0, 255)
    # paint the dead space the same flat colour, so bilinear sampling at an
    # island edge cannot drag the old texture back in
    out[~binary_dilation(mask, iterations=3)] = colour
    return Image.fromarray(np.concatenate([out, alpha], 2).astype(np.uint8), "RGBA")


def main():
    j, bin_ = read_glb(IN)
    views = [bytearray(bin_[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
             for bv in j["bufferViews"]]

    # what each image is, and which primitives paint themselves with it
    kind_of_image, prims_of_image = {}, {}
    for mesh in j.get("meshes", []):
        for prim in mesh["primitives"]:
            if "material" not in prim:
                continue
            mat = j["materials"][prim["material"]]
            name = (mat.get("name") or "").lower()
            tex = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if not tex:
                continue
            src = j["textures"][tex["index"]]["source"]
            prims_of_image.setdefault(src, []).append(prim)
            if "body" in name:
                kind = "skin"
            elif any(h in name for h in ("hair", "ponytail", "braid", "bob", "afro", "short0", "long0")):
                kind = "hair"
            else:
                kind = "garment"
            leg = any(k in name for k in ("trouser", "jean", "pant", "shoe", "boot"))
            kind_of_image[src] = (kind, leg)

    # Normal maps ride along with their material but are never recoloured. Some
    # of the pack's garments carry the same UV-bleed defect in their normal map
    # as in their colour, which prints a blocky relief onto otherwise flat
    # cloth; flatten those. Footwear normals are clean and worth keeping.
    for mat in j.get("materials", []):
        nt = mat.get("normalTexture")
        if not nt:
            continue
        name = (mat.get("name") or "").lower()
        keep = any(k in name for k in ("shoe", "boot"))
        kind_of_image[j["textures"][nt["index"]]["source"]] = ("normal" if keep else "flatnormal", False)

    top, legc = hex_rgb(TOP), hex_rgb(LEG)
    for idx, im in enumerate(j.get("images", [])):
        bv_i = im["bufferView"]
        img = Image.open(io.BytesIO(bytes(views[bv_i])))
        kind, leg = kind_of_image.get(idx, ("garment", False))
        name = im.get("name", "")
        low = name.lower()
        # the image's own name is the reliable signal: the eye material is
        # called "low-poly", which no material-name matching catches
        if "eye" in low and "eyebrow" not in low and "eyelash" not in low:
            kind = "eyes"
        elif "skin" in low:
            kind = "skin"
        elif "normal" in low and kind not in ("flatnormal",):
            kind = "normal"

        if kind == "flatnormal":
            img = Image.new("RGB", (8, 8), (128, 128, 255))
        elif kind == "normal":
            img = fit(img, GARMENT_MAX)
        elif kind == "skin":
            img = fit(img, SKIN_MAX)
        elif kind == "garment" or (kind == "hair" and HAIR):
            colour = hex_rgb(HAIR) if kind == "hair" else (legc if leg else top)
            img = fit(img, GARMENT_MAX if kind == "garment" else OTHER_MAX)
            mask = uv_mask(j, bin_, prims_of_image.get(idx, []), img.width, img.height)
            img = technical_fabric(img, colour, mask)
        else:
            img = fit(img, OTHER_MAX)

        if kind == "garment":
            img = img.convert("RGB")
        buf = io.BytesIO()
        if img.mode == "RGBA":
            img.save(buf, "PNG", optimize=True)
            im["mimeType"] = "image/png"
        else:
            img.convert("RGB").save(buf, "JPEG", quality=88)
            im["mimeType"] = "image/jpeg"
        views[bv_i] = bytearray(buf.getvalue())
        print(f"  {name or idx:40s} {kind:8s} -> {img.size} {len(views[bv_i])//1024} KB")

    # MakeHuman exports every garment alpha-blended and double-sided. Blending
    # has no depth sorting, so a solid shirt shows its own inside faces and the
    # body behind them through itself — which reads as a blocky patchwork
    # printed on the cloth, and is what made these characters look wrong. Solid
    # cloth is opaque and single-sided. Hair genuinely needs its cutout, but
    # masking sorts correctly where blending does not.
    for mat in j.get("materials", []):
        name = (mat.get("name") or "").lower()
        if any(h in name for h in ("hair", "ponytail", "braid", "bob", "afro", "short0", "long0")):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
            mat["doubleSided"] = True
        elif "body" in name or "eye" in name or "low-poly" in name:
            mat["alphaMode"] = "OPAQUE"
        else:
            mat["alphaMode"] = "OPAQUE"
            mat["doubleSided"] = False

    print(f"WROTE {OUT} {write_glb(j, views, OUT) // 1024} KB")


if __name__ == "__main__":
    main()
