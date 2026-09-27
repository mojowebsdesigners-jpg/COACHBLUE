# Coach Blue — full site extraction

Everything pulled from `https://coach-blue.com/` before the revamp: palette,
typography, copy, structure, assets, and the platform it was built on.

> **How this was captured.** The live site sits behind a Simply.com WAF that
> answers plain requests with a `454 Checking your browser` proof-of-work
> challenge — even for images. Rendered text came through a JS-capable fetch;
> the raw HTML, the Elementor design-token CSS and every image were recovered
> from Wayback Machine snapshots (`20260415073511`, and `20240825145431` for
> the kit CSS, which is not in the newer capture).

---

## 1. Platform

| | |
|---|---|
| CMS | WordPress |
| Theme | Page Builder Framework + **`lenus-child-theme`** |
| Page builder | Elementor 3.28.1 + Elementor **Pro** 3.23.0 |
| Scroll animation lib | **AOS** (Animate On Scroll) — `lenus-child-theme/assets/aos/` |
| Coaching platform | **Lenus.io** (footer: "Powered by Lenus.io") |
| A/B testing | Visual Website Optimizer (VWO) |
| SEO | Yoast (JSON-LD `yoast-schema-graph`) |
| Page title | `Coach Blue - online-coaching` |
| Structure | **Single page**, all nav links are in-page anchors |

---

## 2. Colour palette

Taken verbatim from the Elementor global kit (`post-11.css`) and the compiled
page CSS (`post-2.css`). These are the exact brand values.

### Kit globals

| Role | Hex | Swatch use |
|---|---|---|
| **Primary** | `#1DE9B6` | The signature mint. Every accent, CTA, eyebrow label, active state. |
| **Secondary** | `#0A5240` | Deep green, used sparingly for depth |
| **Accent** | `#1C1C1C` | Near-black — the page ground |
| **Text** | `#BEBEBE` | Body copy on dark |
| — | `#FFFFFF` | Headings |
| — | `#E1E1E1` | Light surface |
| — | `#EDEEEF` | Light surface alt |

### Surfaces and greys found in the compiled page CSS

| Hex | Occurrences | Role |
|---|---|---|
| `#242424` | 12 × `background-color` | Card / panel surface |
| `#2E2E2E` | 4 × `background-color` | Elevated surface |
| `#0D1717` | 3 | Very dark green-black band |
| `#808080` | 24 | Muted text |
| `#686868` | 24 | Dimmer muted text |
| `#BDBCBC` | 8 | Hairlines / borders |
| `#1A1A1A`, `#000000` | few | Deepest grounds |

### Translucent brand washes (used as-is in the original)

| Value | Meaning |
|---|---|
| `#1DE9B60D` | mint @ 5 % — tinted panel background (7 uses) |
| `#1DE9B60F` | mint @ 6 % — tinted panel background (2 uses) |
| `#1C1C1CE6` | near-black @ 90 % — sticky nav backdrop |

**All of the above are reproduced as CSS custom properties in
`assets/css/site.css` under `:root`.** Nothing was invented; nothing was dropped.

---

## 3. Typography

### Display face — `forma-djr-display`

Served from **Adobe Typekit**, kit id **`tnd7kgj`**:

```html
<link rel="stylesheet" href="https://use.typekit.net/tnd7kgj.css">
```

The kit ships the **full range: weights 100–900, roman + italic** (36 faces).
A copy of the kit CSS is saved at `docs/typekit-reference.css`.

> ⚠️ The Typekit kit is domain-locked to the account that owns it. It works on
> `coach-blue.com`; if the revamp is served from a different domain, that domain
> must be added to the kit in Adobe Fonts, or the fonts silently fall back.

### Body face — `Inter`

Self-hosted by Elementor as a local Google Font
(`elementor/google-fonts/css/inter.css`). Weights used: **300, 400, 500**.

### The original's type scale (Elementor global typography)

| Token | Family | Size | Weight | Line-height | Transform / tracking |
|---|---|---|---|---|---|
| `primary` (H1) | forma-djr-display | 3.6rem → 2.7rem | 600 | 3.3rem | — |
| `secondary` (H2) | forma-djr-display | 4rem → 3.3rem → 2.8rem | 600 | matches size | `capitalize` |
| `text` (H3) | forma-djr-display | 2.5rem → 2rem | 600 | matches size | `capitalize` |
| `accent` (eyebrow) | forma-djr-display | 1rem | 500 | 1rem | **`letter-spacing: 0.18rem`** |
| body | Inter | 1.125rem / 1rem | 400 / 300 | 150 % | — |
| small | Inter | 0.875rem | 400 | 150 % | — |

The **0.18rem-tracked mint eyebrow** is the single most recognisable type
detail on the site. It is preserved exactly as `.eyebrow` in the revamp.

---

## 4. Page structure (in order)

| # | Anchor | Content |
|---|---|---|
| 1 | — | Hero: "Online Fitness Coaching" / **Achieve Your Fitness Goals** + form CTA |
| 2 | — | Stats: **+1000** Clients Transformed · **100 %** physique improvement |
| 3 | — | Client Q / Coach Blue A quote pair |
| 4 | `#reviews` | "get real Results" + programme paragraph |
| 5 | — | **My clients goals**: Better Lifestyle · Lose Weight · Gain Muscle · Get Toned |
| 6 | — | **Reviews From People Like You** — before/after carousel |
| 7 | — | "What to expect from me" / *Are you willing to take on the challenge?* |
| 8 | `#how` | **How Coaching works** — 4 steps |
| 9 | `#app` | **Advance Fitness App** — 4 features |
| 10 | `#me` | **Your goals are my goals** — Lucas Dasilva bio + socials |
| 11 | `#faq` | FAQ — 5 questions |
| 12 | — | **Ready to start your journey?** final CTA |
| 13 | — | Footer |

---

## 5. Links

| Label | URL |
|---|---|
| Apparel | `https://iammilitarymuscle.com/password?` |
| Inquiry form (real destination) | `https://inspireonlinecoaching.com/coaching/` |
| Facebook | `https://www.facebook.com/people/Lucas-Dasilva-Fit/100079064104938/` |
| Instagram | `https://www.instagram.com/coach.bluee/` |
| TikTok | `https://www.tiktok.com/@coach.bluee?lang=en` |
| Website Terms | `https://www.lenusehealth.com/legal/coach-website-terms-of-use` |
| Privacy Policy | `https://us.lenus.io/coach-blue/data-policy?locale=en-US` |
| Coaching Information | `https://us.lenus.io/coach-blue/coaching-information?locale=en-US` |

All in-page CTAs (`Sign up here`, `Start now`, `Join Now`, `Sign Up`) pointed at
`#form`, which held the Lenus inquiry embed.

---

## 6. Recovered assets

Downloaded to `assets/img/` (16 of 18 recovered; the two `PSD_2*.webp` app
mockups are not in any archive snapshot).

| File | Original name | Size | Note |
|---|---|---|---|
| `logo.png` | `photo1713450171-removebg-preview.png` | 270×278 | Emblem **+ "COACH BLUE" wordmark**, transparent |
| `logo.svg` | *(traced)* | — | 14 vector paths, traced from the PNG alpha for the draw animation |
| `coach-cutout.webp` | `DSC09467.webp` | 835×2017 | **Already background-free** — Lucas, arms crossed. Used for the hero mask reveal |
| `coach-training.jpg` | `IMG_8124.jpg` | 1395×930 | Gym shot |
| `coach-running.webp` | `IMG_2129v.webp` | 665×890 | Outdoor |
| `motivation.webp` | `Untitled-design.webp` | 1080×1920 | Reel still, "YOU DO NOT RESPECT YOURSELF!" |
| `transform-1…11.webp` | `photo-output-*.webp` | up to 4446×2680 | **Client before/after transformations** — the highest-quality assets on the site |

`photo-output-2-1-1.webp` and `photo-output-2-4.webp` were byte-identical
duplicates; one copy was kept.

**No video existed on the original site** — the six clips are new.

---

## 7. Full copy (verbatim)

### Hero
> **Online Fitness Coaching**
> **Achieve Your Fitness Goals**
> Get started by filling out this form and tell me about what you want to accomplish.

### Stats
> +1000 Clients Transformed · 100% physique improvement

### Quote pair
> **Client** — "What if I do not have a gym membership?"
> **Coach Blue** — "No problem, I have a range of different workouts for all levels."

### get real Results
> Transform your life with Coach Blue's unique and powerful training program, designed for busy
> professionals like truck drivers, law enforcement, and military personnel. Our no-nonsense
> approach ensures you stay consistent, motivated, and accountable while losing weight and building
> discipline. Experience ultimate motivation and lasting results with Coach Blue's expert guidance
> and varied workout techniques.

**My clients goals:** Better Lifestyle · Lose Weight · Gain Muscle · Get Toned

### What to expect from me
> I am a hard-ass trainer. If you are willing to stick through my program I know for a guaranteed
> that you will achieve your fitness goals.
>
> **Are you willing to take on the challenge?**

### How Coaching works
> Meet Coach Blue, your dedicated online military fitness mentor. With a rigorous approach rooted in
> military discipline, Coach Blue emphasizes accountability, ensuring you stay on track with regular
> check-ins and unwavering support. Building a strong relationship with you, Coach Blue tailors every
> aspect of your fitness journey, providing custom meal plans and training programs that fit your
> unique needs. Weekly check-ins allow for continual adjustments to keep you progressing. Join Coach
> Blue to push beyond your limits and achieve transformative results from the comfort of your home or gym.

1. **Fill out our form.** My team or I will reach out within 24 hours via text to see how we can achieve your goals together. You and I will work together to reach your goals if it is a good fit. Start by filling out the inquiry form so we can setup our call.
2. **I contact you** — I will be reaching out to you via text within 48 hours! You will also receive an email after submitting your form as confirmation that I have received your information.
3. **Get your plans** — Building you the perfect plan that is customized completely to YOU! Plans for in the gym or at home. Meal plans built with your preference in mind!
4. **Start achieving your goals** — Daily communication with me as your coach & weekly check ins drive results and our passion for realistic fitness is what sets my coaching apart. What are you waiting for?

### Advance Fitness App
> My fitness app offers a comprehensive solution for your health goals, combining check-ins, custom
> meal plans, personalized workout plans, and seamless communication in my all in one platform. Stay
> accountable with regular check-ins, enjoy tailored meal and workout plans, and easily connect with
> myself for support and adjustments. Achieve your best self with everything you need at your fingertips.

Custom Meal Plan · Progress Tracking · Unique Workout Plan · Regular Check-Ins

### Your goals are my goals
> I, Lucas Dasilva, have dedicated myself to the world of calisthenics and body weight exercises and
> the world of bodybuilding. I understand now how to use both to maximize someone's fitness journey.
> I believe that you can do it all and you can accomplish it all at the same time during your fitness
> journey. You can absolutely burn fat, build muscle, and get functional at the same time. You just
> need proper structure and adherence to a plan tailored to your needs.

### FAQ
- **Can I train from home?** I can create you a full in gym plan or an at home plan that only requires some or no equipment. You choose what plan is best for you!
- **How often should I workout?** Depending on how advanced and intense you want your training, the maximum anyone should work out is 3 to 5 times per week.
- **Is there somewhere I can track my progress?** Yes all in my App, where I also monitor and track your progress along with you.
- **Do you cater for dietary restrictions?** Whether you have dietary restrictions, allergies, food preferences etc. I can create you your own custom meal plan which you'll love and enjoy.
- **How do you differ from other coaches?** I am here to emphasize building a true relationship with you and push you along your journey. I will be your ultimate motivator as long as you stick to the plan!

### Closing
> **Ready to start your journey?**
> Let's do this. A happier and healthier life is waiting for you, you just need to chase it.

### Footer
> ©2026 Coach Blue. All Rights Reserved · Website Terms | Privacy Policy | Coaching Infomation · Powered by Lenus.io

*(Note: the original footer misspells "Information" as "Infomation". Corrected in the revamp.)*

---

## 8. What the original did for motion

Only **AOS** — simple `fadeInUp` / `fadeInDown` on scroll, plus an Elementor
Swiper carousel for the reviews. That is the entire animation surface of the
old site, which is why the revamp has so much room to move.
