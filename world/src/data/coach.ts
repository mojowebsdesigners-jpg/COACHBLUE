// Source: https://coach-blue.com/ (copy kept verbatim; see docs/BRAND-EXTRACTION.md)

export const coach = {
  brand: 'Coach Blue',
  name: 'Lucas Dasilva',
  eyebrow: 'Online Fitness Coaching',
  headline: 'Achieve Your Fitness Goals',
  intro:
    'Get started by filling out this form and tell me about what you want to accomplish.',
  portrait: '/img/coach-cutout.webp',
  photos: {
    training: '/img/coach-training.webp',
    running: '/img/coach-running.webp',
    motivation: '/img/motivation.webp',
  },

  stats: [
    { value: '+1000', label: 'Clients Transformed' },
    { value: '100%', label: 'physique improvement' },
  ],

  quotePair: {
    client: 'What if I do not have a gym membership?',
    coach: 'No problem, I have a range of different workouts for all levels.',
  },

  realResults: {
    title: 'get real Results',
    body:
      "Transform your life with Coach Blue's unique and powerful training program, designed for busy professionals like truck drivers, law enforcement, and military personnel. Our no-nonsense approach ensures you stay consistent, motivated, and accountable while losing weight and building discipline. Experience ultimate motivation and lasting results with Coach Blue's expert guidance and varied workout techniques.",
  },

  expect: {
    title: 'What to expect from me',
    body:
      'I am a hard-ass trainer. If you are willing to stick through my program I know for a guaranteed that you will achieve your fitness goals.',
    challenge: 'Are you willing to take on the challenge?',
  },

  about: {
    title: 'Your goals are my goals',
    body:
      "I, Lucas Dasilva, have dedicated myself to the world of calisthenics and body weight exercises and the world of bodybuilding. I understand now how to use both to maximize someone's fitness journey. I believe that you can do it all and you can accomplish it all at the same time during your fitness journey. You can absolutely burn fat, build muscle, and get functional at the same time. You just need proper structure and adherence to a plan tailored to your needs.",
  },

  howItWorks: {
    title: 'How Coaching works',
    body:
      'Meet Coach Blue, your dedicated online military fitness mentor. With a rigorous approach rooted in military discipline, Coach Blue emphasizes accountability, ensuring you stay on track with regular check-ins and unwavering support. Building a strong relationship with you, Coach Blue tailors every aspect of your fitness journey, providing custom meal plans and training programs that fit your unique needs. Weekly check-ins allow for continual adjustments to keep you progressing. Join Coach Blue to push beyond your limits and achieve transformative results from the comfort of your home or gym.',
  },

  closing: {
    title: 'Ready to start your journey?',
    body: "Let's do this. A happier and healthier life is waiting for you, you just need to chase it.",
  },

  goals: ['Better Lifestyle', 'Lose Weight', 'Gain Muscle', 'Get Toned'],
} as const
