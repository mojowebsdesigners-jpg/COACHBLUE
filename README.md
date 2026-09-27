# Coach Blue — scroll-driven film

The whole site is one clip. There is no copy and no navbar: scroll position is
the playhead. Scrolling **down** runs the film forward *with its audio*;
scrolling **up** scrubs it backward in silence.

Source: `WhatsApp Video 2026-09-07 at 10.07.34 PM.mp4` (99.4s), Instagram
watermark removed.

---

## Run it

> **It must be served by something that supports HTTP Range.** A `<video>`
> cannot seek without it, and the film will sit frozen at 0:00 — which looks
> exactly like a broken page. Python's stock `http.server` does **not** support
> Range, so use the bundled server:

```bash
python tools/serve.py          # http://127.0.0.1:8899/
```

Nearly every real host (Netlify, Vercel, Cloudflare, nginx, Apache, S3) supports
Range out of the box, so this only matters locally.

---

## How the transport works

`assets/js/film.js`, ~140 lines, no dependencies.

```
progress = scrollY / (trackHeight - viewportHeight)
target   = progress * duration
delta    = target - video.currentTime
```

| Case | Behaviour | Why |
|---|---|---|
| `delta > 0.05` | **Play** forward, `playbackRate = clamp(1 + delta*1.2, 0.7, 2.0)`, unmuted | Real playback, so speech comes out at natural pitch. The rate nudge lets it converge on where scroll says it should be. |
| `delta > 2.5` | Seek most of the way, then play | A flick would need 6× playback, which is just noise. |
| `delta < -0.05` | **Pause**, mute, seek frame by frame | A video cannot speak backwards. Seeking reads as reverse playback and stays silent. |
| settled | Pause | Otherwise it would run on past the scroll position. |

The rAF loop only spins while the film is off its mark, plus ~45 frames of
slack, then parks itself.

**Scroll length** is `--track: 3200vh` in `assets/css/film.css` — about 32
screens for 99.4s. That means an ordinary wheel scroll advances the film at
roughly 1×, which is what keeps the speech intelligible. Shorten it to make the
film move faster per scroll; lengthen it to slow it down.

**Sound** starts off, because no browser will let a page make noise before
someone has interacted with it. The speaker button (bottom right, icon only)
unlocks it — pressing it calls `play()` inside the click handler, which is what
actually satisfies the autoplay policy.

---

## Aspect ratio

The source is 9:16. `tools/build_hero.py` lays it over a blurred, cropped copy
of itself to make a 16:9 frame, so the portrait content is never cropped and
never letterboxed with dead black.

Two cuts ship, and `film.js` picks one **before load**, so only one is fetched:

| File | Size | Served to |
|---|---|---|
| `assets/video/hero.mp4` | 1280×720, 20.9 MB | anything wider than 3:4 |
| `assets/video/hero-portrait.mp4` | 404×720, 13.0 MB | phones held upright (`max-aspect-ratio: 3/4`) |

The portrait cut is the exact centre band of the 16:9 (`crop=404:720:438:0`),
i.e. the original framing with none of the blurred fill. Cropping the *wide*
cut back to portrait with `object-fit: cover` was the obvious shortcut, but it
shaves about 9% off each side — enough to clip the burned-in captions.

850 → 720 is a downscale, so both cuts stay sharp despite the low-resolution
source.

---

## Rebuilding the film

```bash
python tools/build_hero.py                       # watermark removal + 16:9 + audio
ffmpeg -i assets/video/hero.mp4 -vf "crop=404:720:438:0" \
  -c:v libx264 -preset slow -crf 25 -g 15 -keyint_min 15 -sc_threshold 0 \
  -pix_fmt yuv420p -c:a copy -movflags +faststart assets/video/hero-portrait.mp4
```

`build_hero.py` reuses the watermark stencils in `tools/masks/`. To rebuild
those from scratch (only needed for a different set of source clips):

```bash
python tools/wm_build_masks.py
```

**Keyframes are deliberately dense** (`-g 15`, one every half second). Scrolling
up seeks constantly, and seek cost is dominated by keyframe distance. It inflates
the file, but it is the difference between scrubbing and stuttering.

### About the watermark removal

The Instagram overlay hops between two anchors and fades in over about a second.
Two things that shaped the approach:

1. Edge *magnitude* is a useless detector — a white glyph on a pale gym ceiling
   scores no higher than no watermark at all. **Normalised cross-correlation**
   against a stencil is contrast-invariant and tracks the fade.
2. The overlay is right-aligned at the top anchor and left-aligned at the left
   one, so its lines share a vertical edge. Bands are snapped to that edge —
   without it the music-credit line stays partly legible.

---

## Layout

```
index.html                    the page (no copy, no nav)
assets/css/film.css           palette + sticky stage + the icon-only controls
assets/js/film.js             the scroll transport
assets/video/hero.mp4         16:9 cut, with audio
assets/video/hero-portrait.mp4  9:16 cut, with audio
assets/img/hero-poster.webp   poster frame
tools/build_hero.py           watermark removal -> 16:9 -> audio mux
tools/wm_build_masks.py       builds the watermark stencils
tools/serve.py                dev server WITH Range support
source-videos/                the untouched originals
_previous/                    the earlier multi-section build, kept for reference
docs/BRAND-EXTRACTION.md      everything extracted from the old coach-blue.com
```

`assets/video/clip1-6.mp4`, `assets/frames/` and `assets/img/transform-*.webp`
are the other five cleaned clips and the extracted stills — unused right now,
kept for the sections that come next.

---

## Known limits

- **20.9 MB** for the wide cut. It streams progressively, so playback starts
  immediately, but scrolling far ahead before that region has buffered will
  pause on a frame until it arrives. Dropping to CRF 27 would roughly halve it.
- The source is **478×850**, WhatsApp-compressed. Both cuts are downscales of
  it, so they look clean, but there is no detail to recover. The original
  1080×1920 Reel would be a visible upgrade — drop it into `source-videos/` and
  re-run `build_hero.py`.
