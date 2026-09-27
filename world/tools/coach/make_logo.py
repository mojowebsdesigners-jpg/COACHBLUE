"""Draw the chest logo — a dumbbell crossed with a rifle — as a clean mask.

    python tools/coach/make_logo.py raw/coach_hero/tex/logo.png

Traced by eye from the reference: the dumbbell runs top-left to bottom-right
with square plates, the rifle's muzzle points top-right with the stock at the
bottom-left. White on transparent, 1024 px, so it stays crisp in a close-up.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
S = 1024
SS = 4                       # supersample, then downscale for clean edges
W = S * SS
img = Image.new("L", (W, W), 0)
d = ImageDraw.Draw(img)


def rot(pts, ang, cx, cy):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + (x * c - y * s) * SS, cy + (x * s + y * c) * SS) for x, y in pts]


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


cx, cy = W / 2, W / 2
# dumbbell: bar, collars, two square plates each end
ang = math.radians(33)
parts = [rect(-400, -14, 400, 14),
         rect(-300, -70, -210, 70), rect(-335, -52, -300, 52),
         rect(210, -70, 300, 70), rect(300, -52, 335, 52),
         rect(-430, -10, -335, 10), rect(335, -10, 430, 10)]
for p in parts:
    d.polygon(rot(p, ang, cx, cy - 10 * SS), fill=255)

# rifle, muzzle to the right, in its own frame (x along the barrel)
ang2 = math.radians(-27)
rifle = [
    rect(60, -24, 390, -4),          # barrel
    rect(-40, -34, 150, 10),         # handguard
    rect(150, -30, 190, 4),          # gas block
    [(170, -34), (190, -34), (185, -78), (172, -78)],   # front sight post
    rect(-190, -40, -40, 18),        # receiver
    rect(-170, -70, -60, -40),       # carry handle / optic
    rect(-150, -80, -80, -70),
    [(-110, 18), (-70, 18), (-60, 140), (-95, 140)],    # magazine
    [(-160, 18), (-135, 18), (-150, 90), (-178, 90)],   # grip
    [(-190, -30), (-330, -16), (-360, 58), (-300, 58), (-190, 16)],   # stock
    rect(-372, -12, -345, 62),       # butt plate
]
for p in rifle:
    d.polygon(rot(p, ang2, cx + 10 * SS, cy + 20 * SS), fill=255)

img = img.resize((S, S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
rgba = Image.merge("RGBA", (Image.new("L", (S, S), 245),) * 3 + (img,))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
rgba.save(OUT)
print("WROTE", OUT)
