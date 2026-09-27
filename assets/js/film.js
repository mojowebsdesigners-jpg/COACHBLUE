/* ==========================================================================
   Coach Blue — scroll transport
   --------------------------------------------------------------------------
   Scroll position is the playhead.

   Going DOWN, the clip is allowed to actually play, so the speech comes out at
   something close to natural pitch. The playback rate is nudged so the film
   converges on where the scroll says it should be; if it falls too far behind
   (a flick, a jump to an anchor) it seeks instead, because playing at 6x is
   just noise.

   Going UP, it never plays — a video cannot speak backwards — so it is paused,
   muted, and seeked frame by frame. That reads as reverse playback and stays
   silent, which is the whole point.
   ========================================================================== */
(() => {
  "use strict";

  const film = document.getElementById("film");
  const track = document.getElementById("track");
  const fill = document.getElementById("barfill");
  const cue = document.getElementById("cue");
  const soundBtn = document.getElementById("sound");
  if (!film || !track) return;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* --- pick the cut ------------------------------------------------------
     Chosen once, before load, so only one file is ever fetched. A tall
     viewport takes the portrait cut; everything else takes the 16:9. */
  const tall = matchMedia("(max-aspect-ratio: 3/4)").matches;
  film.src = (tall && film.dataset.tall) ? film.dataset.tall : film.dataset.wide;

  /* --- tuning -------------------------------------------------------------
     DEAD   how close counts as "on the mark" — stops hunting around the target
     CATCH  beyond this the film hard-seeks instead of trying to play faster
     RATE   playback-rate ceiling; past ~2x speech stops being speech        */
  const DEAD = 0.05;
  const CATCH = 2.5;
  const RATE_MIN = 0.7;
  const RATE_MAX = 2.0;

  let wantAudio = false;
  let duration = 0;
  let distance = 1;
  let raf = 0;
  let idle = 0;
  let moved = false;

  const measure = () => {
    distance = Math.max(track.offsetHeight - window.innerHeight, 1);
  };

  film.addEventListener("loadedmetadata", () => {
    duration = film.duration || 0;
    measure();
    tick();
  });

  /* --- the loop ----------------------------------------------------------- */
  function tick() {
    raf = 0;
    if (!duration) return;

    const p = clamp(window.scrollY / distance, 0, 1);
    const target = p * duration;
    const cur = film.currentTime;
    const delta = target - cur;

    if (fill) fill.style.transform = `scaleX(${p.toFixed(5)})`;

    if (delta > DEAD) {
      // ---- forward: let it run, with sound
      if (delta > CATCH) {
        // too far behind to play back into place — jump most of the way there
        film.currentTime = target - 0.25;
      }
      film.playbackRate = clamp(1 + delta * 1.2, RATE_MIN, RATE_MAX);
      film.muted = !wantAudio;
      if (film.paused) film.play().catch(() => {});
    } else if (delta < -DEAD) {
      // ---- backward: silent scrub, never playback
      if (!film.paused) film.pause();
      film.muted = true;
      seek(target);
    } else {
      // ---- settled on the mark
      if (!film.paused) film.pause();
    }

    // keep spinning briefly after the last scroll so playback can converge
    if (Math.abs(delta) > DEAD || idle > 0) {
      idle = Math.abs(delta) > DEAD ? 45 : idle - 1;
      raf = requestAnimationFrame(tick);
    }
  }

  function seek(t) {
    // fastSeek trades exactness for speed, which is the right trade while
    // scrubbing; Chrome does not have it, so fall back to an assignment
    if (typeof film.fastSeek === "function") film.fastSeek(t);
    else film.currentTime = t;
  }

  function kick() {
    idle = 45;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  addEventListener("scroll", () => {
    if (!moved) {
      moved = true;
      cue?.classList.add("gone");
    }
    kick();
  }, { passive: true });

  addEventListener("resize", () => { measure(); kick(); }, { passive: true });

  /* --- sound -------------------------------------------------------------
     Browsers will not let a page make noise until someone has interacted with
     it, so the first press both flips the flag and unlocks playback. */
  soundBtn?.addEventListener("click", () => {
    wantAudio = !wantAudio;
    soundBtn.setAttribute("aria-pressed", String(wantAudio));
    film.muted = !wantAudio;
    // playing inside the click handler is what actually unlocks audio
    film.play().then(() => { if (film.currentTime >= duration - 0.05) film.pause(); })
               .catch(() => {});
    kick();
  });

  // If the tab is hidden there is nothing to drive and nothing to hear.
  addEventListener("visibilitychange", () => {
    if (document.hidden && !film.paused) film.pause();
  });

  measure();
  if (film.readyState >= 1) {
    duration = film.duration || 0;
    tick();
  }
})();
