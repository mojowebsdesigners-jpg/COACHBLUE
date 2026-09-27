"""Trace the logo PNG's alpha channel into SVG paths.

An <img> can't be stroke-drawn; a real path can. We contour the alpha mask,
simplify it, and emit paths whose length we can animate with stroke-dashoffset.
"""
import numpy as np, cv2

im = cv2.imread("assets/img/logo.png", cv2.IMREAD_UNCHANGED)
h, w = im.shape[:2]
alpha = im[:, :, 3] if im.shape[2] == 4 else cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
mask = (alpha > 110).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
paths = []
for c in cnts:
    if cv2.contourArea(c) < 40:
        continue
    eps = 0.0035 * cv2.arcLength(c, True)
    a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
    d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in a) + " Z"
    paths.append((cv2.contourArea(c), d))

paths.sort(key=lambda p: -p[0])
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill="none">']
for i, (_, d) in enumerate(paths):
    svg.append(f'  <path class="lp" d="{d}"/>')
svg.append("</svg>")
open("assets/img/logo.svg", "w").write("\n".join(svg))
print(f"{len(paths)} paths, viewBox 0 0 {w} {h}")
for a, d in paths:
    print(f"  area={a:8.0f}  pts={d.count('L')+1}")
