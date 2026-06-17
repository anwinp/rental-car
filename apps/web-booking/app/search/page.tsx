// Server component — no 'use client'

import { Suspense } from 'react'
import { SearchResults } from './SearchResults'
import { SearchSkeleton } from './SearchSkeleton'
import { FilterPanel } from './FilterPanel'
import { SearchBar } from './SearchBar'

interface SearchPageProps {
  searchParams: {
    pickup?: string
    dropoff?: string
    from?: string
    to?: string
    class_filter?: string
    sort?: string
  }
}

export const revalidate = 0

export default function SearchPage({ searchParams }: SearchPageProps) {
  const {
    pickup     = '',
    dropoff    = '',
    from       = '',
    to         = '',
    class_filter = '',
    sort       = 'price_asc',
  } = searchParams

  const classFilters = class_filter
    ? class_filter.split(',').map(c => c.trim()).filter(Boolean)
    : []

  return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 64 }}>

      {/* Sticky search bar — shows current params + Modify Search form */}
      <SearchBar
        pickup={pickup}
        from={from}
        to={to}
        sort={sort}
        classFilter={classFilters}
      />

      {/* Main content */}
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '32px 48px',
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: 32,
        alignItems: 'start',
      }}>
        {/* Sort sidebar — desktop only */}
        <aside className="hidden lg:block">
          <FilterPanel
            classFilter={classFilters}
            sort={sort}
            pickup={pickup}
            dropoff={dropoff}
            from={from}
            to={to}
          />
        </aside>

        {/* Results column */}
        <div>
          {/* Mobile: filter toggle */}
          <div className="lg:hidden" style={{ marginBottom: 20 }}>
            <FilterPanel
              classFilter={classFilters}
              sort={sort}
              pickup={pickup}
              dropoff={dropoff}
              from={from}
              to={to}
              mobile
            />
          </div>

          <Suspense fallback={<SearchSkeleton />}>
            <SearchResults
              pickupLocationId={pickup}
              dropoffLocationId={dropoff || pickup}
              pickupDate={from}
              dropoffDate={to}
              sort={sort}
              classFilter={classFilters}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
