// Server component — no 'use client'

import { Suspense } from 'react'
import { SearchResults } from './SearchResults'
import { SearchSkeleton } from './SearchSkeleton'
import { FilterPanel } from './FilterPanel'

interface SearchPageProps {
  searchParams: {
    pickup?: string
    dropoff?: string
    from?: string
    to?: string
    pickup_time?: string
    return_time?: string
    one_way?: string
    class_filter?: string
    sort?: string
  }
}

export const revalidate = 0

export default function SearchPage({ searchParams }: SearchPageProps) {
  const {
    pickup = '',
    dropoff = '',
    from = '',
    to = '',
    pickup_time = '10:00 AM',
    return_time = '10:00 AM',
    class_filter = '',
    sort = 'price_asc',
  } = searchParams

  const classFilters = class_filter
    ? class_filter.split(',').map(c => c.trim()).filter(Boolean)
    : []

  const pickupLabel = pickup || 'All locations'
  const dateLabel = from && to ? `${from} — ${to}` : ''

  return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 64 }}>
      {/* Search context bar — sticks below fixed Navbar */}
      <div style={{
        background: '#303030',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 48px',
        position: 'sticky',
        top: 64,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1280,
          margin: '0 auto',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#969696', textTransform: 'uppercase', letterSpacing: '1.1px', margin: '0 0 2px' }}>
              Available Vehicles
            </p>
            <h1 style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>
              {pickupLabel}
              {dateLabel && <span style={{ color: '#969696', fontWeight: 400 }}> &middot; {dateLabel}</span>}
              {pickup_time && from && <span style={{ color: '#969696', fontWeight: 400 }}> &middot; {pickup_time}</span>}
            </h1>
          </div>
          <a href={`/?pickup=${encodeURIComponent(pickup)}&from=${from}&to=${to}`} className="search-modify-link">
            Modify Search
          </a>
          <style>{`
            .search-modify-link {
              font-size: 13px; font-weight: 600; font-family: inherit;
              color: #969696; text-decoration: none;
              border: 1px solid #969696; padding: 8px 20px;
              letter-spacing: 0.65px; text-transform: uppercase;
              transition: color 0.15s, border-color 0.15s;
              white-space: nowrap;
            }
            .search-modify-link:hover { color: #ffffff; border-color: #ffffff; }
          `}</style>
        </div>
      </div>

      {/* Content */}
      <div style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '40px 48px',
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 32,
      }}>
        {/* Filter sidebar — desktop */}
        <aside className="hidden lg:block">
          <FilterPanel
            classFilter={classFilters}
            sort={sort}
            pickup={pickup}
            dropoff={dropoff}
            from={from}
            to={to}
            pickupTime={pickup_time}
            returnTime={return_time}
          />
        </aside>

        {/* Results */}
        <div>
          {/* Mobile filter toggle */}
          <div className="lg:hidden" style={{ marginBottom: 24 }}>
            <FilterPanel
              classFilter={classFilters}
              sort={sort}
              pickup={pickup}
              dropoff={dropoff}
              from={from}
              to={to}
              pickupTime={pickup_time}
              returnTime={return_time}
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
