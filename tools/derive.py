"""Build every derived asset from the cleaned clips.

  assets/video/clipN.mp4    delivery encode (H.264 — universally supported)
  assets/frames/poster/     one poster per clip (also the <video> poster)
  assets/frames/scrub/      the image sequence the sticky section scrubs
  assets/frames/still/      stills for mosaics / decorative use

Masters (CRF 23) are kept in assets/video/master so the site can be re-encoded
without re-running watermark removal.
"""
import os, subprocess, shutil, json

V = "assets/video"
M = f"{V}/master"
F = "assets/frames"
SCRUB_FROM, SCRUB_N = 1, 120        # clip1 drives the sticky scroll section
STILLS = 8


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        print("  ! ffmpeg:", r.stderr.strip().splitlines()[-1:])
    return r.returncode == 0


def dur(p):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
        capture_output=True, text=True).stdout.strip())


os.makedirs(M, exist_ok=True)
for d in ("poster", "scrub", "still"):
    os.makedirs(f"{F}/{d}", exist_ok=True)

# stash the masters once
for i in range(1, 7):
    src, dst = f"{V}/clip{i}.mp4", f"{M}/clip{i}.mp4"
    if os.path.exists(src) and not os.path.exists(dst):
        shutil.move(src, dst)

meta = {}
for i in range(1, 7):
    m = f"{M}/clip{i}.mp4"
    if not os.path.exists(m):
        print(f"clip{i}: master missing, skipped"); continue
    d = dur(m)
    print(f"clip{i}  {d:.1f}s")

    # --- delivery encodes -------------------------------------------------
    run(["ffmpeg", "-v", "error", "-y", "-i", m, "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-g", "60",
         f"{V}/clip{i}.mp4"])
    # --- poster (a frame ~12% in, past any fade-up) -----------------------
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{d*0.12:.2f}", "-i", m,
         "-frames:v", "1", "-c:v", "libwebp", "-quality", "78",
         f"{F}/poster/clip{i}.webp"])

    # --- stills spread across the clip ------------------------------------
    for s in range(STILLS):
        t = d * (0.06 + 0.88 * s / max(STILLS - 1, 1))
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", m,
             "-frames:v", "1", "-c:v", "libwebp", "-quality", "78",
             f"{F}/still/clip{i}-{s+1:02d}.webp"])

    meta[f"clip{i}"] = {"duration": round(d, 2),
                        "mp4_mb": round(os.path.getsize(f'{V}/clip{i}.mp4') / 1e6, 2)}

# --- the scrub sequence ---------------------------------------------------
m = f"{M}/clip{SCRUB_FROM}.mp4"
if os.path.exists(m):
    d = dur(m)
    fps = SCRUB_N / d          # resample the whole clip down to SCRUB_N frames
    print(f"scrub: {SCRUB_N} frames from clip{SCRUB_FROM} @ {fps:.3f} fps")
    # -f image2 is REQUIRED: given a .webp output ffmpeg otherwise picks the
    # animated-webp muxer and writes one file instead of a numbered sequence.
    # -c:v libwebp + -f image2 are BOTH required: for a .webp output ffmpeg
    # defaults to the libwebp_anim encoder and writes one animated file
    # instead of a numbered sequence.
    run(["ffmpeg", "-v", "error", "-y", "-i", m,
         "-vf", f"fps={fps:.6f}", "-frames:v", str(SCRUB_N),
         "-c:v", "libwebp", "-quality", "72", "-f", "image2",
         f"{F}/scrub/%04d.webp"])
    got = len(os.listdir(f"{F}/scrub"))
    print(f"  -> {got} frames")
    meta["scrub"] = {"frames": got, "from": f"clip{SCRUB_FROM}"}

json.dump(meta, open("tools/masks/derived.json", "w"), indent=2)
print("\n" + json.dumps(meta, indent=2))
