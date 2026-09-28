// Where everything stands in the forest, and the order the guided journey walks it.
// The player starts at the entrance (south, +z) and climbs to the summit (north, -z).

export type LocationId =
  | 'entrance'
  | 'coach'
  | 'challenge'
  | 'camp'
  | 'discipline'
  | 'hundred'
  | 'gallery'
  | 'hub'
  | 'campfire'
  | 'summit'
  | 'faq'
  | 'goals'
  | 'bootcamp'
  | 'funpark'
  | 'stunts'

export type Location = {
  id: LocationId
  name: string
  word?: string          // the word carved into the world at that place
  pos: [number, number]  // x, z
  pad: number            // flattened radius
  discoverRadius: number
  onPath: boolean        // part of the guided journey
}

export const locations: Location[] = [
  { id: 'entrance',   name: 'The Entrance',            word: 'BEGIN',       pos: [0, 150],    pad: 14, discoverRadius: 22, onPath: true },
  { id: 'coach',      name: 'Coach Blue',              word: 'MEET',        pos: [-17, 116],  pad: 13, discoverRadius: 20, onPath: true },
  { id: 'challenge',  name: 'The Challenge',           word: 'COMMIT',      pos: [-6, 86],    pad: 11, discoverRadius: 18, onPath: true },
  { id: 'camp',       name: "The Coach's Training Camp", word: 'BUILD',     pos: [-36, 54],   pad: 18, discoverRadius: 26, onPath: true },
  { id: 'discipline', name: 'The Discipline Path',     word: 'DISCIPLINE',  pos: [-12, 16],   pad: 10, discoverRadius: 30, onPath: true },
  { id: 'hundred',    name: '100 Days of Discipline',  word: '100',         pos: [34, -28],   pad: 24, discoverRadius: 34, onPath: true },
  { id: 'gallery',    name: 'The Transformation Gallery', word: 'PROOF',    pos: [4, -70],    pad: 20, discoverRadius: 28, onPath: true },
  { id: 'hub',        name: 'The Coaching Hub',        word: 'STRUCTURE',   pos: [-34, -94],  pad: 16, discoverRadius: 24, onPath: true },
  { id: 'campfire',   name: 'Reviews From People Like You', word: 'REAL',   pos: [-8, -122],  pad: 14, discoverRadius: 22, onPath: true },
  { id: 'summit',     name: 'The Final Summit',        word: 'TRANSFORM',   pos: [0, -168],   pad: 16, discoverRadius: 30, onPath: true },
  // off the guided path — rewards for exploring
  { id: 'faq',        name: 'The Question Cave',       word: 'ASK',         pos: [62, 34],    pad: 14, discoverRadius: 20, onPath: false },
  { id: 'goals',      name: 'Your Goals',              word: 'GOALS',       pos: [40, 104],   pad: 15, discoverRadius: 22, onPath: false },
  { id: 'bootcamp',   name: 'Boot Camp',               word: 'GRIT',        pos: [-54, 100],  pad: 15, discoverRadius: 22, onPath: false },
  { id: 'funpark',    name: 'The Fun Park',            word: 'PLAY',        pos: [-54, 6],    pad: 22, discoverRadius: 30, onPath: false },
  { id: 'stunts',     name: 'The Stunt Yard',          word: 'SEND IT',     pos: [-16, -26],  pad: 22, discoverRadius: 30, onPath: false },
]

export const locationById = Object.fromEntries(locations.map((l) => [l.id, l])) as Record<LocationId, Location>

// Control points for the main trail, in walking order, with a couple of extra
// bends so it curves through the trees instead of running straight.
export const pathPoints: [number, number][] = [
  [0, 168],
  [0, 150],
  [-6, 134],
  [-17, 116],
  [-14, 100],
  [-6, 86],
  [-16, 72],
  [-36, 54],
  [-34, 40],
  [-22, 26],
  [-12, 16],
  [0, 4],
  [14, -8],
  [26, -18],
  [34, -28],
  [30, -44],
  [18, -58],
  [4, -70],
  [-14, -80],
  [-34, -94],
  [-26, -110],
  [-8, -122],
  [-4, -140],
  [0, -155],
  [0, -168],
]

export type JourneyStep = {
  id: LocationId
  label: string
  line: string       // shown when the step begins
}

export const journeySteps: JourneyStep[] = [
  { id: 'coach',      label: 'Meet Coach Blue',        line: 'EVERY TRANSFORMATION STARTS WITH A DECISION.' },
  { id: 'challenge',  label: 'The Challenge',          line: 'ARE YOU WILLING TO TAKE ON THE CHALLENGE?' },
  { id: 'camp',       label: 'The Training Camp',      line: "LET'S GET TO WORK." },
  { id: 'discipline', label: 'The Discipline Path',    line: 'REAL STRENGTH IS BUILT, NOT BORROWED.' },
  { id: 'hundred',    label: '100 Days of Discipline', line: 'ONE HUNDRED DAYS. ONE DECISION A DAY.' },
  { id: 'gallery',    label: 'Transformations',        line: 'RESULTS ARE BUILT.' },
  { id: 'hub',        label: 'The Coaching Hub',       line: 'STRUCTURE IS WHAT MAKES IT REPEATABLE.' },
  { id: 'campfire',   label: 'Reviews',                line: 'PEOPLE LIKE YOU. WHO STARTED ANYWAY.' },
  { id: 'summit',     label: 'The Summit',             line: "YOU'VE SEEN THE JOURNEY." },
]

// Words carved along the trail between the big stops (environmental storytelling).
export const trailWords: { text: string; pos: [number, number] }[] = [
  { text: 'DISCIPLINE',  pos: [-24, 30] },
  { text: 'CONSISTENCY', pos: [4, 0] },
  { text: 'COMMIT',      pos: [-14, 76] },
  { text: 'TRANSFORM',   pos: [-2, -150] },
]
