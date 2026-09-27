"""Who is being built. Set CB_PROFILE (coach | client-a | client-b | client-c).

Every stage reads its settings from here, so one pipeline builds Coach Blue
and the three gym clients as genuinely different people: their own build and
proportions, face, skin tone, eyes, hair, and gym kit.
"""
import os

NAME = os.environ.get("CB_PROFILE", "coach")

# ------------------------------------------------------------------ coach
COACH = {
    "macros": {"gender": 1.0, "age": 0.4, "muscle": 1.0, "weight": 0.64,
               "height": 0.6, "proportions": 0.8,
               "african": 0.55, "asian": 0.2, "caucasian": 0.25},
    "targets": None,            # body.py's own table
    "skin": {"tone": "#66412f", "red": "#744136", "dark": "#3c241c", "lips": "#5e3337",
             "scalp": "#3a2a24", "nails": "#b08a7e"},
    "iris": "#3a2014",
    "hair": {"style": "coils", "melanin": 1.0, "redness": 0.12},
    "stubble": True,
    "top": {"kind": "tee", "color": "#0e1422", "logo": True},
    "bottom": {"kind": "cargo", "color": "#0b0e15"},
    "shoes": "#101112",
    "necklace": True,
}

# ------------------------------------------------------------------ clients
CLIENT_A = {
    # a lean, athletic woman in her mid twenties, runner's build
    "macros": {"gender": 0.0, "age": 0.53, "muscle": 0.72, "weight": 0.44,
               "height": 0.575, "proportions": 0.75,
               "african": 0.08, "asian": 0.12, "caucasian": 0.8},
    "targets": {
        "upperarm-muscle": 0.3, "lowerarm-muscle": 0.25, "upperarm-fat": -0.4,
        "torso-muscle-dorsi": 0.25, "stomach-tone": 0.7, "stomach-pregnant": -0.4,
        "measure-waist-circ": -0.35, "upperleg-muscle": 0.55, "lowerleg-muscle": 0.45,
        "upperleg-fat": -0.2, "buttocks-volume": 0.25,
        "head-oval": 0.5, "chin-width": -0.15, "cheek-bones": 0.35, "nose-scale-horiz": -0.1,
        "nose-point-width": -0.2, "mouth-upperlip-volume": 0.2, "mouth-lowerlip-volume": 0.25,
        "eye-scale": 0.12,
    },
    "skin": {"tone": "#c48f73", "red": "#c07866", "dark": "#9a6a55", "lips": "#a85d5d",
             "scalp": "#9a735f", "nails": "#e2bfb3"},
    "iris": "#4a3a20",
    "hair": {"style": "ponytail", "melanin": 0.82, "redness": 0.35},
    "brow": 0.45,
    "stubble": False,
    "top": {"kind": "tank", "color": "#1f8f80", "logo": False},
    "bottom": {"kind": "leggings", "color": "#101115"},
    "shoes": "#e9e9e6",
    "necklace": False,
}

CLIENT_B = {
    # a broad, heavy-set man in his mid thirties, strong through the chest
    "macros": {"gender": 1.0, "age": 0.62, "muscle": 0.72, "weight": 0.86,
               "height": 0.45, "proportions": 0.55,
               "african": 0.9, "asian": 0.0, "caucasian": 0.1},
    "targets": {
        "torso-muscle-pectoral": 0.6, "measure-bust-circ": 0.4, "stomach-pregnant": 0.25,
        "measure-waist-circ": 0.2, "upperarm-muscle": 0.5, "measure-neck-circ": 0.6,
        "upperleg-muscle": 0.4, "head-round": 0.35, "head-fat": 0.3, "chin-width": 0.3,
        "nose-scale-horiz": 0.4, "nose-flaring": 0.4, "mouth-lowerlip-volume": 0.3,
    },
    "skin": {"tone": "#4a2c21", "red": "#5a3027", "dark": "#2f1b15", "lips": "#4a2627",
             "scalp": "#2a1c17", "nails": "#9c7a6e"},
    "iris": "#2a170e",
    "hair": {"style": "buzz", "melanin": 1.0, "redness": 0.08},
    "brow": 0.8,
    "stubble": True,
    "top": {"kind": "tee", "color": "#5c6166", "logo": False},
    "bottom": {"kind": "shorts", "color": "#15171a"},
    "shoes": "#1b1d20",
    "necklace": False,
}

CLIENT_C = {
    # a lean man in his late twenties, wiry and quick
    "macros": {"gender": 1.0, "age": 0.56, "muscle": 0.65, "weight": 0.45,
               "height": 0.572, "proportions": 0.7,
               "african": 0.1, "asian": 0.7, "caucasian": 0.2},
    "targets": {
        "upperarm-muscle": 0.4, "lowerarm-muscle": 0.35, "torso-muscle-pectoral": 0.3,
        "stomach-tone": 0.6, "measure-waist-circ": -0.2, "upperleg-muscle": 0.3,
        "head-square": 0.45, "chin-width": 0.4, "chin-bones": 0.45, "chin-prominent": 0.25,
        "cheek-bones": 0.35, "nose-scale-vert": 0.1, "eye-scale": -0.1, "forehead-nubian": 0.2,
        "mouth-upperlip-volume": -0.2, "measure-neck-circ": 0.35,
    },
    "skin": {"tone": "#b58a6a", "red": "#b87a64", "dark": "#8e6a52", "lips": "#9a6060",
             "scalp": "#8a6a55", "nails": "#d9b8a8"},
    "iris": "#26170c",
    "hair": {"style": "straight", "melanin": 0.97, "redness": 0.05},
    "brow": 0.75,
    "stubble": True,
    "top": {"kind": "tank", "color": "#1c2a44", "logo": False},
    "bottom": {"kind": "joggers", "color": "#6a6e73"},
    "shoes": "#2a2c30",
    "necklace": False,
}

PROFILES = {"coach": COACH, "client-a": CLIENT_A, "client-b": CLIENT_B, "client-c": CLIENT_C}
P = PROFILES[NAME]
