"""Build the single scroll-driven hero clip.

Takes one source reel, removes the Instagram watermark exactly as before, then
lays the 9:16 footage over a blurred 16:9 fill so it fits a wide screen. The
centre of the 16:9 frame IS the untouched portrait, so a phone in portrait can
`object-fit: cover` straight back to the original framing with nothing lost.

Audio is KEPT this time -- the scroll drives the speech -- and muxed back from
the source, since the inpainted video travels through a raw pipe.

Keyframes are dense (-g 15, half a second) because scrolling backwards seeks
constantly, and seek cost is dominated by keyframe distance.
"""
import os, subprocess, sys
import numpy as np, cv2

SRC_DIR = "source-videos"
SRC = os.path.join(SRC_DIR, "WhatsApp Video 2026-09-07 at 10.07.34 PM.mp4")
OUT = "assets/video/hero.mp4"
POSTER = "assets/img/hero-poster.webp"

W, H, FPS = 478, 850, 30
OUT_H = 720                      # 850 -> 720 is a downscale, so it stays sharp
OUT_W = 1280

d = np.load("tools/masks/canon.npz")
RECT = {"A": tuple(int(v) for v in d["rectA"]), "B": tuple(int(v) for v in d["rectB"])}
DET = {"A": d["detA"], "B": d["detB"]}
PAINT = {"A": d["paintA"], "B": d["paintB"]}
ANCH = tuple(RECT)
TPL = {k: (DET[k].astype(np.float32) - DET[k].astype(np.float32).mean()) for k in ANCH}
T_HI, T_LO, PAD = 0.20, 0.12, 5

# portrait laid over a blurred, cropped copy of itself
VF = (
    "[0:v]split=2[bg][fg];"
    f"[bg]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,"
    f"crop={OUT_W}:{OUT_H},gblur=sigma=32,eq=brightness=-0.16:saturation=0.65[bgb];"
    f"[fg]scale=-2:{OUT_H}:flags=lanczos[fgs];"
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2:format=auto[v]"
)


def frames(path, pix="bgr24", chan=3):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo",
                          "-pix_fmt", pix, "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
    n = W * H * chan
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield (np.frombuffer(buf, np.uint8).reshape(H, W, chan) if chan > 1
               else np.frombuffer(buf, np.uint8).reshape(H, W))
    p.stdout.close(); p.wait()


def score_pass(path):
    sc = {k: [] for k in ANCH}
    for f in frames(path, "gray", 1):
        for k in ANCH:
            x, y, w, h = RECT[k]
            lap = np.abs(cv2.Laplacian(f[y:y + h, x:x + w].astype(np.float32), cv2.CV_32F, ksize=3))
            l = lap - lap.mean(); t = TPL[k]
            sc[k].append(float((l * t).sum() / (np.sqrt((l * l).sum() * (t * t).sum()) + 1e-6)))
    return {k: np.array(v) for k, v in sc.items()}


def intervals(s):
    on = np.zeros(len(s), bool); cur = False
    for i, v in enumerate(s):
        cur = v > T_HI if not cur else v > T_LO
        on[i] = cur
    return np.convolve(on, np.ones(PAD * 2 + 1, bool), "same") > 0


def main():
    os.makedirs("assets/video", exist_ok=True)
    print("scoring frames…")
    act = {k: intervals(v) for k, v in score_pass(SRC).items()}
    n = len(next(iter(act.values())))
    for k in act:
        print(f"  anchor {k}: {act[k].sum()}/{n} frames ({act[k].mean()*100:.0f}%)")

    print("inpainting + encoding 16:9 with audio…")
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", SRC,                                  # audio comes from the original
        "-filter_complex", VF,
        "-map", "[v]", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-movflags", "+faststart", "-shortest", OUT,
    ], stdin=subprocess.PIPE)

    for i, fr in enumerate(frames(SRC)):
        fr = fr.copy()
        for k in ANCH:
            if i < n and act[k][i]:
                x, y, w, h = RECT[k]
                fr[y:y + h, x:x + w] = cv2.inpaint(fr[y:y + h, x:x + w], PAINT[k], 4, cv2.INPAINT_TELEA)
        enc.stdin.write(fr.tobytes())
        if i % 300 == 0:
            print(f"  {i}/{n}", flush=True)
    enc.stdin.close(); enc.wait()

    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "2", "-i", OUT,
                    "-frames:v", "1", "-c:v", "libwebp", "-quality", "80", POSTER])

    info = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size:stream=codec_type,width,height,codec_name",
         "-of", "default=noprint_wrappers=1", OUT], capture_output=True, text=True).stdout
    print("\n" + info)
    print(f"{OUT}  {os.path.getsize(OUT)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
