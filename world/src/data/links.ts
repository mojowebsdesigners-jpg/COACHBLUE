// Every outbound destination used on the original coach-blue.com.
// All sign-up CTAs on the old site scrolled to an embedded Lenus form whose
// real destination is the inquiry page below.
export const LINKS = {
  // Coach Blue's own site: the Hybrid Athlete System free training
  hybrid: 'https://www.coachblue.fit/',
  inquiry: 'https://inspireonlinecoaching.com/coaching/',
  hundredDays: 'https://coach-blue.com/100daysofdiscipline/',
  apparel: 'https://iammilitarymuscle.com/password?',
  instagram: 'https://www.instagram.com/coach.bluee/',
  tiktok: 'https://www.tiktok.com/@coach.bluee?lang=en',
  facebook: 'https://www.facebook.com/people/Lucas-Dasilva-Fit/100079064104938/',
  terms: 'https://www.lenusehealth.com/legal/coach-website-terms-of-use',
  privacy: 'https://us.lenus.io/coach-blue/data-policy?locale=en-US',
  coachingInfo: 'https://us.lenus.io/coach-blue/coaching-information?locale=en-US',
} as const

/** Open one of Coach Blue's sites in a new tab (never navigating away from the world). */
export function openLink(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer')
}
