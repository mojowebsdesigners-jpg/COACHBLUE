/**
 * What people in the world say when you stop to talk. Three or four lines
 * each: it is there for atmosphere and for pointing at things to do, not for
 * a dialogue tree. `cta` marks a chat that ends on Coach Blue's coaching, so
 * the world can offer it (rationed, see systems/Coaching).
 */
export type Chat = { lines: { who: 'them' | 'you'; text: string }[]; cta?: boolean }

export const CHATS: Chat[] = [
  { lines: [
    { who: 'them', text: 'Coach! You tried the hill sprint up past the camp yet?' },
    { who: 'you', text: 'Every week. It never gets easier — you just get faster.' },
    { who: 'them', text: "Ha. Then I'm doing it again tomorrow." },
  ] },
  { lines: [
    { who: 'them', text: 'Down twelve kilos since spring. My knees thank you.' },
    { who: 'you', text: 'That was all you. I just wrote the plan.' },
    { who: 'them', text: "Tell that to the version of me that couldn't run a lap." },
  ], cta: true },
  { lines: [
    { who: 'them', text: "Water's cold in the lake this morning." },
    { who: 'you', text: "Best recovery there is. Ten minutes, easy strokes." },
  ] },
  { lines: [
    { who: 'them', text: 'The treadmill at the camp — you set the pace yourself, right?' },
    { who: 'you', text: 'W to push it, S to ease off. Start slower than you think.' },
    { who: 'them', text: 'Slower than I think. Got it.' },
  ] },
  { lines: [
    { who: 'them', text: 'Some days I just come here to sit by the water.' },
    { who: 'you', text: 'Rest is training too. Most people skip that part.' },
  ] },
  { lines: [
    { who: 'them', text: "I keep stalling on pull-ups. Three and I'm done." },
    { who: 'you', text: 'Then do three, five times a day. Grease the groove.' },
    { who: 'them', text: 'Five times a day... okay. I can do that.' },
  ], cta: true },
  { lines: [
    { who: 'them', text: 'Is it true you check in on every client, every week?' },
    { who: 'you', text: 'Every one. Accountability is half the programme.' },
  ], cta: true },
  { lines: [
    { who: 'them', text: 'Found mushrooms all over the woods on my run.' },
    { who: 'you', text: "Whole foods from the ground up. Just know what you're picking." },
  ] },
]
