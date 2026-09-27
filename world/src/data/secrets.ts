// Quiet discoveries off the trail. Every line here is Coach Blue's own copy from
// coach-blue.com — nothing invented, nothing gamified.
import { coach } from './coach'

export type Secret = {
  id: string
  name: string
  pos: [number, number]
  kind: 'photo' | 'viewpoint' | 'quote' | 'notebook' | 'training'
  title: string
  body: string
  image?: string
}

export const secrets: Secret[] = [
  {
    id: 'notebook',
    name: "The Coach's Notebook",
    pos: [-52, 96],
    kind: 'notebook',
    title: 'The notebook',
    body: coach.about.body,
    image: undefined,
  },
  {
    id: 'quote-stone',
    name: 'The Standing Stone',
    pos: [26, 48],
    kind: 'quote',
    title: 'What to expect from me',
    body: `${coach.expect.body}\n\n${coach.expect.challenge}`,
  },
  {
    id: 'hidden-photo',
    name: 'The Hanging Photograph',
    pos: [-62, -34],
    kind: 'photo',
    title: 'Motivation',
    body: coach.realResults.body,
    image: '/img/motivation.webp',
  },
  {
    id: 'viewpoint',
    name: 'The Overlook',
    pos: [58, -96],
    kind: 'viewpoint',
    title: 'The overlook',
    body: coach.closing.body,
  },
  {
    id: 'hidden-camp',
    name: 'The Old Training Ground',
    pos: [-78, -8],
    kind: 'training',
    title: 'The old training ground',
    body: coach.quotePair.coach,
  },
]
