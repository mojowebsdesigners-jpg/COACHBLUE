// The live site shows reviews as before/after photos only; it publishes no written
// quotes or client names. Add real, client-approved testimonials here and they
// appear around the campfire (and in the classic view) automatically.
export type Testimonial = {
  quote: string
  name?: string
  image?: string
}

export const testimonials: Testimonial[] = []

export const reviews = {
  title: 'Reviews From People Like You',
}
