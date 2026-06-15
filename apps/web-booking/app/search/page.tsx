import { Suspense } from 'react'
import { Providers } from '../providers'
import { SearchResults } from './SearchResults'
import { SearchSkeleton } from './SearchSkeleton'

interface SearchPageProps {
  searchParams: {
    pickup?: string
    dropoff?: string
    from?: string
    to?: string
  }
}

export const revalidate = 60 // ISR: revalidate every 60 seconds

export default function SearchPage({ searchParams }: SearchPageProps) {
  const { pickup = '', dropoff = '', from = '', to = '' } = searchParams

  return (
    <Providers>
      <div className="min-h-screen bg-background">
        {/* Search Header */}
        <header className="border-b bg-card px-4 py-4">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-xl font-semibold">
              Available Cars
              {pickup && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  in {pickup}
                  {from && to && ` · ${from} → ${to}`}
                </span>
              )}
            </h1>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 py-8">
          <Suspense fallback={<SearchSkeleton />}>
            <SearchResults
              pickupLocationId={pickup}
              dropoffLocationId={dropoff}
              pickupDate={from}
              dropoffDate={to}
            />
          </Suspense>
        </div>
      </div>
    </Providers>
  )
}
