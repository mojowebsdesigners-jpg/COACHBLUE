"""Remove the Instagram watermark from the six clips and emit web-ready media.

Two passes per clip:
  1. score every frame at both anchors (edge energy on the watermark stencil
     vs. the ring just outside it) -> hysteresis -> "on" intervals, padded by a
     few frames so fade in/out is covered.
  2. re-decode and inpaint (Telea) only inside an active anchor's ROI, then
     encode. Untouched frames pass through bit-for-bit in the raw domain.

Audio is dropped: the clips carry licensed Reels music, and muted is required
for autoplay anyway.
"""
import os, json, subprocess, sys
import numpy as np, cv2

SRC = "source-videos"          # the untouched originals
W, H, FPS = 478, 850, 30
d = np.load("tools/masks/canon.npz")
# RECT: where to look.  DET: fine stencil used to detect.  PAINT: solid bars
# used to inpaint -- fragmented letters would leave a readable ghost.
RECT = {"A": tuple(int(v) for v in d["rectA"]), "B": tuple(int(v) for v in d["rectB"])}
DET = {"A": d["detA"], "B": d["detB"]}
PAINT = {"A": d["paintA"], "B": d["paintB"]}
ANCH = tuple(RECT)
# zero-mean stencils for normalised cross-correlation
TPL = {k: (DET[k].astype(np.float32) - DET[k].astype(np.float32).mean()) for k in ANCH}
T_HI, T_LO = 0.20, 0.12   # hysteresis on NCC
PAD = 5                   # frames of safety either side of a detected interval
OUT = "assets/video"


def frames(path, pix="bgr24", chan=3):
    """Stream decoded frames without holding the whole clip in memory."""
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo",
                          "-pix_fmt", pix, "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
    n = W * H * chan
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, chan) if chan > 1 else \
              np.frombuffer(buf, np.uint8).reshape(H, W)
    p.stdout.close(); p.wait()


def score_pass(path):
    """Per-frame watermark score: NCC of the region's edge map with the stencil.

    Plain edge *magnitude* is contrast-dependent -- a white glyph on a pale gym
    ceiling scores as low as no watermark at all, and the overlay fades in over
    ~1s rather than popping. Correlation is scale-invariant, so it tracks the
    fade and ignores how much contrast the underlying shot happens to have.
    """
    sc = {k: [] for k in ANCH}
    for f in frames(path, "gray", 1):
        for k in ANCH:
            x, y, w, h = RECT[k]
            lap = np.abs(cv2.Laplacian(f[y:y + h, x:x + w].astype(np.float32),
                                       cv2.CV_32F, ksize=3))
            l = lap - lap.mean()
            t = TPL[k]
            sc[k].append(float((l * t).sum() /
                               (np.sqrt((l * l).sum() * (t * t).sum()) + 1e-6)))
    return {k: np.array(v) for k, v in sc.items()}


def intervals(s):
    """Hysteresis threshold -> boolean per-frame activity, padded."""
    t_hi, t_lo = T_HI, T_LO
    on = np.zeros(len(s), bool)
    cur = False
    for i, v in enumerate(s):
        cur = v > t_hi if not cur else v > t_lo
        on[i] = cur
    if PAD:                       # dilate temporally
        k = np.ones(PAD * 2 + 1, bool)
        on = np.convolve(on, k, "same") > 0
    return on


def process(path, idx):
    s = score_pass(path)
    act = {k: intervals(v) for k, v in s.items()}
    n = len(next(iter(act.values())))
    for k in act:
        print(f"    anchor {k}: active {act[k].sum()}/{n} frames ({act[k].mean()*100:.0f}%)")

    mp4 = f"{OUT}/clip{idx}.mp4"
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-g", "60", mp4],
        stdin=subprocess.PIPE)

    for i, fr in enumerate(frames(path)):
        fr = fr.copy()
        for k in ANCH:
            if i < n and act[k][i]:
                x, y, w, h = RECT[k]
                roi = fr[y:y + h, x:x + w]
                fr[y:y + h, x:x + w] = cv2.inpaint(roi, PAINT[k], 4, cv2.INPAINT_TELEA)
        enc.stdin.write(fr.tobytes())
    enc.stdin.close(); enc.wait()
    return mp4, {k: act[k].tolist() for k in act}


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    vids = sorted(os.path.join(SRC, f) for f in os.listdir(SRC) if f.endswith(".mp4"))
    meta = {}
    for i, v in enumerate(vids, 1):
        print(f"[{i}/6] {v}")
        mp4, act = process(v, i)
        sz = os.path.getsize(mp4) / 1e6
        print(f"    -> {mp4}  {sz:.1f} MB")
        meta[f"clip{i}"] = {"source": v, "mp4": mp4}
    json.dump(meta, open("tools/masks/clips.json", "w"), indent=2)
    print("\nDONE")
