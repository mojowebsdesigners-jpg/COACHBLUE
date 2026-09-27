"""Build both watermark stencils, in one reproducible pass.

Two different masks are needed and they must not be confused:

  det   -- fine outline of the glyph + letters. Used to DETECT the overlay by
           correlating it against each frame's edge map. Correlation only works
           if the template has the watermark's actual structure.
  paint -- the same components grouped into solid bars. Used to INPAINT. Thin
           fragmented letters leave readable ghosts between the strokes, so the
           painted region has to be continuous.

Stage 1 unions six independent per-clip detections, stage 2 strips static
content edges, stage 3 solidifies into bands.
"""
import os, subprocess
import numpy as np, cv2

SRC = "source-videos"          # the untouched originals
W, H = 478, 850
REGIONS = {"A": (296, 186, 168, 104), "B": (36, 546, 176, 92)}
THRESH = 0.24


def read_gray(path, step=2):
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", r"select='not(mod(n\,%d))'" % step,
         "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True)
    a = np.frombuffer(p.stdout, np.uint8)
    n = a.size // (W * H)
    return a[: n * W * H].reshape(n, H, W)


def persistence(g, rect):
    x, y, w, h = rect
    acc = np.zeros((h, w), np.float32)
    for f in g:
        acc += np.abs(cv2.Laplacian(f[y:y + h, x:x + w], cv2.CV_32F, ksize=3))
    acc /= len(g)
    return acc / (acc.max() + 1e-6)


# ---- stage 1: union the six per-clip detections --------------------------
# cached: stage 1 is the slow pass, stages 2-3 are cheap to re-tune
CACHE = "tools/masks/union.npz"
if os.path.exists(CACHE):
    _c = np.load(CACHE)
    union = {k: _c[k] for k in REGIONS}
    print("stage 1: loaded cached union")
    vids = []
else:
    union = {k: np.zeros((r[3], r[2]), np.uint8) for k, r in REGIONS.items()}
    vids = sorted(os.path.join(SRC, f) for f in os.listdir(SRC) if f.endswith(".mp4"))
for i, v in enumerate(vids, 1):
    g = read_gray(v)
    for k, rect in REGIONS.items():
        m = (persistence(g, rect) > THRESH).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
        for j in range(1, nlab):
            if stats[j, cv2.CC_STAT_AREA] >= 6:
                union[k][lab == j] = 1
    print(f"  union: clip{i} done")
if vids:
    os.makedirs("tools/masks", exist_ok=True)
    np.savez(CACHE, **union)

det, paint = {}, {}
for k in ("A", "B"):
    m = cv2.dilate(cv2.morphologyEx(union[k], cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)),
                   np.ones((3, 3), np.uint8))
    h, w = m.shape

    # ---- stage 2: drop static content edges (a pole, a glow frame) --------
    # they run straight through the glyph, so subtract before labelling
    m = np.clip(m - cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((45, 1), np.uint8))
                  - cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((1, 120), np.uint8)), 0, 1).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    fine = np.zeros_like(m)
    for j in range(1, nlab):
        x, y, cw, ch, area = stats[j]
        if ch > 40 or area < 14:
            continue
        if (x <= 0 or y <= 0 or x + cw >= w or y + ch >= h) and area < 200:
            continue
        fine[lab == j] = 1
    fine = cv2.morphologyEx(fine, cv2.MORPH_CLOSE, np.ones((3, 9), np.uint8))
    det[k] = fine

    # ---- stage 3: group into text lines, fill each line's box ------------
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(fine, 8)
    bands = []
    for x, y, bw, bh, _ in sorted((tuple(stats[j]) for j in range(1, nlab)), key=lambda b: b[1]):
        for b in bands:
            top, bot = max(b[1], y), min(b[1] + b[3], y + bh)
            if bot - top > 0.4 * min(b[3], bh):
                nx, ny = min(b[0], x), min(b[1], y)
                b[:] = [nx, ny, max(b[0] + b[2], x + bw) - nx, max(b[1] + b[3], y + bh) - ny]
                break
        else:
            bands.append([x, y, bw, bh])
    # The overlay is right-aligned at anchor A and left-aligned at anchor B, so
    # every line shares one vertical edge. Snapping each band to that shared
    # edge covers lines the union under-measured (clip4's music credit ran a
    # few px past the widest detected extent and stayed legible).
    if k == "A":
        edge = max(x + bw for x, y, bw, bh in bands)
        bands = [[x, y, edge - x, bh] for x, y, bw, bh in bands]
    else:
        edge = min(x for x, y, bw, bh in bands)
        bands = [[edge, y, x + bw - edge, bh] for x, y, bw, bh in bands]

    solid = np.zeros_like(fine)
    for x, y, bw, bh in bands:
        solid[max(y - 2, 0):min(y + bh + 2, h), max(x - 2, 0):min(x + bw + 2, w)] = 1
        print(f"  {k} band  x[{x-2}-{x+bw+2}] y[{y-2}-{y+bh+2}]")
    paint[k] = solid
    cv2.imwrite(f"tools/masks/det_{k}.png", fine * 255)
    cv2.imwrite(f"tools/masks/paint_{k}.png", solid * 255)
    print(f"{k}: det={int(fine.sum())}px  paint={int(solid.sum())}px  bands={len(bands)}\n")

np.savez("tools/masks/canon.npz",
         detA=det["A"], detB=det["B"], paintA=paint["A"], paintB=paint["B"],
         rectA=np.array(REGIONS["A"]), rectB=np.array(REGIONS["B"]))
print("saved tools/masks/canon.npz")
