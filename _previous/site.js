/* ==========================================================================
   Coach Blue — motion engine
   --------------------------------------------------------------------------
   Performance contract, because this page is video-heavy:
     * ONE rAF loop drives every scroll-linked effect. It only spins while the
       page is actually moving, then parks itself.
     * Geometry is measured once and cached; the loop never touches layout.
     * Entrance animations are pure CSS transitions toggled by a single
       IntersectionObserver — no per-frame JS at all.
     * Off-screen <video> elements are paused, so the decoder is never asked
       for more than the two or three clips actually on screen.
   ========================================================================== */
(() => {
  "use strict";

  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ======================================================= scroll scheduler
     Actors register a measure() and a render(scrollY, vh). The loop runs
     while `alive` is positive; scrolling tops it back up. */
  const Scroll = {
    actors: [],
    alive: 0,
    running: false,

    add(actor) {
      this.actors.push(actor);
      actor.measure?.();
      return actor;
    },

    measureAll() {
      for (const a of this.actors) a.measure?.();
      this.kick();
    },

    kick() {
      this.alive = 90;                    // ~1.5s of frames after last input
      if (!this.running) {
        this.running = true;
        requestAnimationFrame(this.tick);
      }
    },

    tick: () => {
      const s = Scroll;
      const y = window.scrollY || window.pageYOffset;
      const vh = window.innerHeight;
      let busy = false;
      for (const a of s.actors) {
        // skip anything comfortably outside the viewport
        if (a.top !== undefined && (a.top > y + vh * 1.4 || a.top + a.h < y - vh * 0.4)) continue;
        if (a.render(y, vh) === true) busy = true;
      }
      s.alive = busy ? 90 : s.alive - 1;
      if (s.alive > 0) requestAnimationFrame(s.tick);
      else s.running = false;
    },
  };

  addEventListener("scroll", () => Scroll.kick(), { passive: true });

  let rzT;
  addEventListener("resize", () => {
    clearTimeout(rzT);
    rzT = setTimeout(() => Scroll.measureAll(), 150);
  }, { passive: true });

  /* ============================================================ split text
     Wraps words (and optionally characters) so each gets a stagger index.
     Word boxes clip, so the letters rise out of nothing. */
  function splitText(el) {
    const mode = el.dataset.split || "chars";
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    let i = 0;
    words.forEach((word, wi) => {
      const w = document.createElement("span");
      w.className = "w";
      if (mode === "words") {
        const s = document.createElement("span");
        s.className = "wi";
        s.style.setProperty("--i", i++);
        s.textContent = word;
        w.appendChild(s);
      } else {
        for (const ch of word) {
          const s = document.createElement("span");
          s.className = "c";
          s.style.setProperty("--i", i++);
          s.textContent = ch;
          w.appendChild(s);
        }
      }
      el.appendChild(w);
      if (wi < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
    el.classList.add("split");
  }

  /* ======================================================== reveal observer
     One observer for every entrance animation on the page. */
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      revealIO.unobserve(e.target);          // one-shot: never re-animates
      // hand the GPU hint back once the transition has finished
      e.target.addEventListener("transitionend", function done() {
        e.target.style.willChange = "auto";
        e.target.removeEventListener("transitionend", done);
      });
    }
    // threshold MUST stay 0. Chrome shrinks the intersection rect by the
    // target's own clip-path, so a `clip-up` element (clipped to zero until it
    // reveals) reports ratio 0 forever and any positive threshold never fires —
    // the clip that hides it also stops the observer seeing it. rootMargin
    // still holds the reveal back until the element is properly on screen.
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0 });

  /* ============================================================== parallax
     data-par="0.18"  → shifts at 18% of scroll distance while in view.
     Optionally data-par-x for a horizontal drift. */
  function initParallax() {
    if (RM) return;
    for (const el of $$("[data-par]")) {
      const amt = parseFloat(el.dataset.par) || 0.15;
      const amtX = parseFloat(el.dataset.parX) || 0;
      Scroll.add({
        el,
        measure() {
          const r = el.getBoundingClientRect();
          this.top = r.top + window.scrollY;
          this.h = r.height;
        },
        render(y, vh) {
          // -1 above centre … +1 below centre
          const p = (y + vh / 2 - (this.top + this.h / 2)) / (vh / 2 + this.h / 2);
          const ty = clamp(p, -1.6, 1.6) * amt * 100;
          const tx = clamp(p, -1.6, 1.6) * amtX * 100;
          // `translate`, not `transform`: several elements carry BOTH a reveal
          // (which animates transform) and parallax. They are separate CSS
          // properties, so writing this one leaves the reveal intact.
          el.style.translate = `${tx.toFixed(2)}px ${ty.toFixed(2)}px`;
        },
      });
    }
  }

  /* ======================================================== scrubbed video
     A sticky stage whose canvas shows frame N of a pre-extracted sequence,
     with N tied to how far through the section you have scrolled. Scrolling
     up runs the clip backwards, which is the whole point.

     An image sequence is used rather than seeking a <video>: seeking is
     asynchronous and stutters, whereas drawing a decoded bitmap is instant. */
  function initScrub() {
    const stage = $("[data-scrub]");
    if (!stage) return;

    const track = stage.closest(".scrub");
    const canvas = $(".scrub-canvas", stage);
    const bar = $(".scrub-progress i", stage);
    const caps = $$(".scrub-cap", stage);
    const total = parseInt(stage.dataset.frames, 10);
    const pad = parseInt(stage.dataset.pad || "4", 10);
    const dir = stage.dataset.scrub;
    const ctx = canvas.getContext("2d", { alpha: false });

    const imgs = new Array(total);
    let ready = 0, lastDrawn = -1, target = 0, current = 0;

    const src = (i) => `${dir}/${String(i + 1).padStart(pad, "0")}.webp`;

    // Load in waves so the first frames are usable almost immediately and the
    // network is never saturated with 120 parallel requests.
    let next = 0;
    const LANES = 6;
    function pump() {
      while (next < total && pump.active < LANES) {
        const i = next++;
        pump.active++;
        const im = new Image();
        im.decoding = "async";
        im.onload = im.onerror = () => {
          imgs[i] = im.naturalWidth ? im : null;
          ready++; pump.active--;
          if (ready === 1) draw(0);
          pump();
        };
        im.src = src(i);
      }
    }
    pump.active = 0;

    function fit(im) {
      const cw = canvas.width, ch = canvas.height;
      const s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
    }

    function draw(i) {
      i = clamp(Math.round(i), 0, total - 1);
      if (i === lastDrawn) return;
      // fall back to the nearest already-decoded frame while loading
      let j = i;
      if (!imgs[j]) {
        let a = j, b = j;
        while (a >= 0 || b < total) {
          if (a >= 0 && imgs[a]) { j = a; break; }
          if (b < total && imgs[b]) { j = b; break; }
          a--; b++;
        }
      }
      if (!imgs[j]) return;
      fit(imgs[j]);
      lastDrawn = i;
    }

    function size() {
      // measure the panel the canvas actually fills, not the whole stage
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      lastDrawn = -1;
      draw(current);
    }

    Scroll.add({
      measure() {
        const r = track.getBoundingClientRect();
        this.top = r.top + window.scrollY;
        this.h = r.height;
        size();
      },
      render(y, vh) {
        const dist = this.h - vh;                       // usable scroll length
        const p = clamp((y - this.top) / (dist || 1));
        target = p * (total - 1);
        // ease toward the target so flick-scrolling still looks like playback
        current = RM ? target : lerp(current, target, 0.18);
        draw(current);
        if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
        for (const c of caps) {
          const a = parseFloat(c.dataset.from), b = parseFloat(c.dataset.to);
          c.classList.toggle("on", p >= a && p <= b);
        }
        return Math.abs(target - current) > 0.35;       // keep the loop warm
      },
    });

    pump();
    addEventListener("resize", size, { passive: true });
  }

  /* ============================================ play videos only when seen */
  function initVideos() {
    const vids = $$("video[data-auto]");
    if (!vids.length) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting) {
          if (v.dataset.src && !v.src) { v.src = v.dataset.src; v.load(); }
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
    }, { rootMargin: "220px 0px", threshold: 0.01 });
    vids.forEach((v) => io.observe(v));
  }

  /* ================================================ mouse parallax (hero) */
  function initMouse() {
    if (RM || matchMedia("(pointer: coarse)").matches) return;
    const layers = $$("[data-mouse]");
    if (!layers.length) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;

    addEventListener("pointermove", (e) => {
      tx = (e.clientX / innerWidth - 0.5) * 2;
      ty = (e.clientY / innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(run);
    }, { passive: true });

    function run() {
      cx = lerp(cx, tx, 0.07);
      cy = lerp(cy, ty, 0.07);
      for (const l of layers) {
        const d = parseFloat(l.dataset.mouse) || 10;
        l.style.setProperty("--mx", `${(cx * d).toFixed(2)}px`);
        l.style.setProperty("--my", `${(cy * d).toFixed(2)}px`);
      }
      raf = Math.abs(cx - tx) + Math.abs(cy - ty) > 0.001 ? requestAnimationFrame(run) : 0;
    }
  }

  /* ============================================================ count-up  */
  function initCounters() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        const to = parseFloat(el.dataset.count);
        if (RM) { el.textContent = el.dataset.prefix || ""; el.textContent += to; continue; }
        const t0 = performance.now(), dur = 1600;
        (function step(t) {
          const p = clamp((t - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (el.dataset.prefix || "") + Math.round(to * eased) + (el.dataset.suffix || "");
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      }
    }, { threshold: 0.5 });
    $$("[data-count]").forEach((el) => io.observe(el));
  }

  /* ================================================================= nav  */
  function initNav() {
    const nav = $("#nav");
    const burger = $(".burger");
    const drawer = $("#drawer");

    const onScroll = () => nav.classList.toggle("stuck", window.scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    burger?.addEventListener("click", () => {
      const open = document.body.classList.toggle("menu-open");
      burger.setAttribute("aria-expanded", String(open));
    });
    $$("#drawer a").forEach((a, i) => {
      a.style.setProperty("--i", i);
      a.addEventListener("click", () => document.body.classList.remove("menu-open"));
    });
    addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.body.classList.remove("menu-open");
      burger?.setAttribute("aria-expanded", "false");
    });
  }

  /* ================================================================= FAQ  */
  function initFaq() {
    // a scripted disclosure rather than <details>: browsers do not render a
    // closed <details>'s children, so its panel cannot be height-animated.
    const all = $$(".qa");
    for (const qa of all) {
      const btn = $(".qa-q", qa);
      btn.addEventListener("click", () => {
        const open = qa.classList.contains("open");
        for (const o of all) {                    // accordion: one at a time
          o.classList.remove("open");
          $(".qa-q", o).setAttribute("aria-expanded", "false");
        }
        if (!open) {
          qa.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    }
  }

  /* =============================================================== splash
     Draw the logo contours, then shatter the panel like cracked glass. */
  function initSplash(done) {
    const splash = $("#splash");
    if (!splash) return done();

    document.body.classList.add("is-locked");

    // give every traced contour its own length + a staggered start
    const paths = $$("#splash .lp");
    paths.forEach((p, i) => {
      const len = p.getTotalLength();
      p.style.setProperty("--len", len.toFixed(1));
      // the big emblem draws first, the wordmark letters follow
      p.style.setProperty("--d", `${(i === 0 ? 0 : 0.35 + i * 0.03).toFixed(2)}s`);
    });

    // build the shatter: concentric rings cut into sectors, so the breaks
    // radiate from an impact point the way real glass does
    const shards = $(".shards");
    const RINGS = [0, 0.17, 0.4, 0.72, 1.35];
    const SECT = 14;
    const ox = 50, oy = 48;                       // impact point, in %
    const jit = (n) => (Math.random() - 0.5) * n;

    for (let r = 0; r < RINGS.length - 1; r++) {
      for (let s = 0; s < SECT; s++) {
        const a0 = (s / SECT) * Math.PI * 2 + jit(0.07);
        const a1 = ((s + 1) / SECT) * Math.PI * 2 + jit(0.07);
        const r0 = RINGS[r] * (1 + jit(0.12));
        const r1 = RINGS[r + 1] * (1 + jit(0.12));
        const pt = (ang, rad) =>
          `${(ox + Math.cos(ang) * rad * 78).toFixed(1)}% ${(oy + Math.sin(ang) * rad * 78).toFixed(1)}%`;

        const poly = r === 0
          ? `polygon(${ox}% ${oy}%, ${pt(a0, r1)}, ${pt(a1, r1)})`
          : `polygon(${pt(a0, r0)}, ${pt(a1, r0)}, ${pt(a1, r1)}, ${pt(a0, r1)})`;

        const mid = (a0 + a1) / 2;
        const push = 260 + r * 190 + Math.random() * 190;
        const el = document.createElement("div");
        el.className = "shard";
        el.style.clipPath = poly;
        el.style.setProperty("--tx", `${(Math.cos(mid) * push).toFixed(0)}px`);
        el.style.setProperty("--ty", `${(Math.sin(mid) * push).toFixed(0)}px`);
        el.style.setProperty("--rot", `${jit(85).toFixed(0)}deg`);
        el.style.setProperty("--sc", (0.72 + Math.random() * 0.3).toFixed(2));
        el.style.transitionDelay = `${(r * 0.045 + Math.random() * 0.09).toFixed(2)}s`;
        shards.appendChild(el);
      }
    }

    const finish = () => {
      splash.classList.add("cracking");
      document.body.classList.remove("is-locked");
      done();
      setTimeout(() => { splash.classList.add("gone"); splash.remove(); }, 1600);
    };

    if (RM) { splash.remove(); document.body.classList.remove("is-locked"); return done(); }

    requestAnimationFrame(() => splash.classList.add("drawing"));
    const t = setTimeout(finish, 2100);
    // let an impatient visitor skip it — pointer or keyboard
    const skip = () => { clearTimeout(t); removeEventListener("keydown", skip); finish(); };
    splash.addEventListener("click", skip, { once: true });
    addEventListener("keydown", skip, { once: true });
  }

  /* ================================================================= boot */
  function boot() {
    $$("[data-split]").forEach(splitText);

    // stagger sibling reveals without hand-writing delays
    $$("[data-stagger]").forEach((group) => {
      const step = parseFloat(group.dataset.stagger) || 0.08;
      [...group.children].forEach((c, i) => {
        const t = c.matches("[data-rv]") ? c : $("[data-rv]", c);
        t?.style.setProperty("--dly", `${(i * step).toFixed(2)}s`);
      });
    });

    initNav();
    initFaq();
    initVideos();
    initCounters();
    initMouse();
    initParallax();
    initScrub();

    Scroll.measureAll();

    // re-measure once late-loading media has settled the layout
    addEventListener("load", () => Scroll.measureAll());
    if (document.fonts?.ready) document.fonts.ready.then(() => Scroll.measureAll());
  }

  function startReveals() {
    $$("[data-rv], .split").forEach((el) => revealIO.observe(el));
  }

  document.addEventListener("DOMContentLoaded", () => {
    boot();
    initSplash(startReveals);
  });
})();
