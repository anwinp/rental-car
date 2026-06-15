import { Providers } from './providers'
import { HeroSearch } from './components/HeroSearch'

export default function HomePage() {
  return (
    <Providers>
      <div className="relative flex min-h-screen flex-col">
        {/* Hero Section */}
        <section
          className="relative flex flex-1 flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/20 px-4 py-24"
          aria-labelledby="hero-heading"
        >
          <div className="mx-auto w-full max-w-4xl text-center">
            <h1
              id="hero-heading"
              className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
            >
              Find Your Perfect{' '}
              <span className="text-primary">Rental Car</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground sm:text-xl">
              Search availability, compare classes, and book in minutes.
              Transparent pricing — no hidden fees.
            </p>

            {/* Search Widget */}
            <div className="mt-10 rounded-2xl border bg-card p-6 shadow-lg text-left">
              <HeroSearch />
            </div>
          </div>
        </section>

        {/* Features strip */}
        <section className="border-t bg-muted/40 px-4 py-12" aria-label="Why choose us">
          <div className="mx-auto max-w-4xl">
            <dl className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {[
                {
                  term: 'Instant Confirmation',
                  def: 'Book and receive your confirmation number in under 60 seconds.',
                },
                {
                  term: 'Free Cancellation',
                  def: 'Cancel up to 24 hours before pickup at no charge.',
                },
                {
                  term: 'No Hidden Fees',
                  def: 'Full pricing breakdown shown before you pay. No surprises.',
                },
              ].map(({ term, def }) => (
                <div key={term} className="text-center">
                  <dt className="text-base font-semibold">{term}</dt>
                  <dd className="mt-2 text-sm text-muted-foreground">{def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </Providers>
  )
}
