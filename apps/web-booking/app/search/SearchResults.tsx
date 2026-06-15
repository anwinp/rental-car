'use client'

import { useAvailability } from '@rcm/api-client'
import { Badge, Card, CardContent, CardFooter, CardHeader, CardTitle, Skeleton } from '@rcm/ui'
import { Button } from '@rcm/ui'
import { useRouter } from 'next/navigation'

interface SearchResultsProps {
  pickupLocationId: string
  dropoffLocationId: string
  pickupDate: string
  dropoffDate: string
}

export function SearchResults({
  pickupLocationId,
  dropoffLocationId,
  pickupDate,
  dropoffDate,
}: SearchResultsProps) {
  const router = useRouter()
  const enabled = !!(pickupLocationId && pickupDate && dropoffDate)

  const { data, isLoading, isError, error } = useAvailability(
    {
      pickup_location_id: pickupLocationId,
      dropoff_location_id: dropoffLocationId || pickupLocationId,
      pickup_date: pickupDate,
      dropoff_date: dropoffDate,
    },
    enabled
  )

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-medium">Enter a location and dates to search for cars.</p>
        <a href="/" className="mt-4 text-sm text-primary underline underline-offset-4">
          Back to search
        </a>
      </div>
    )
  }

  if (isLoading) {
    return <SearchSkeleton />
  }

  if (isError) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center"
      >
        <p className="font-semibold text-destructive">
          {error instanceof Error ? error.message : 'Failed to load availability.'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </div>
    )
  }

  const classes = data?.classes ?? []

  if (classes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-xl font-semibold">No cars available</p>
        <p className="mt-2 text-muted-foreground">
          No vehicles are available for the selected dates and location.
          Try adjusting your search.
        </p>
        <a href="/" className="mt-6 text-sm text-primary underline underline-offset-4">
          Modify search
        </a>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted-foreground" aria-live="polite">
        {classes.length} vehicle class{classes.length !== 1 ? 'es' : ''} available
      </p>
      <div
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Available vehicle classes"
      >
        {classes.map((cls) => (
          <VehicleClassCard
            key={cls.classId}
            vehicleClass={cls}
            onSelect={() =>
              router.push(
                `/booking/${cls.classId}?pickup=${pickupLocationId}&from=${pickupDate}&to=${dropoffDate}`
              )
            }
          />
        ))}
      </div>
    </div>
  )
}

interface VehicleClass {
  classId: string
  classCode: string
  className: string
  description: string
  features: string[]
  imageUrl?: string
  availableCount: number
  baseDailyRate: number
  currencyCode: string
}

function VehicleClassCard({
  vehicleClass: cls,
  onSelect,
}: {
  vehicleClass: VehicleClass
  onSelect: () => void
}) {
  const isLow = cls.availableCount <= 2
  const isUnavailable = cls.availableCount === 0

  return (
    <Card className={isUnavailable ? 'opacity-60' : undefined}>
      {cls.imageUrl && (
        <div className="aspect-[16/9] overflow-hidden rounded-t-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cls.imageUrl}
            alt={`${cls.className} vehicle class`}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {cls.classCode}
            </p>
            <CardTitle className="text-xl">{cls.className}</CardTitle>
          </div>
          {isLow && !isUnavailable && (
            <Badge variant="warning" aria-label="Low availability">
              Only {cls.availableCount} left
            </Badge>
          )}
          {isUnavailable && (
            <Badge variant="destructive" aria-label="Sold out">
              Sold out
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{cls.description}</p>
      </CardHeader>

      <CardContent>
        <ul className="space-y-1" aria-label="Vehicle features">
          {cls.features.slice(0, 4).map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-primary"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold">
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: cls.currencyCode,
              minimumFractionDigits: 2,
            }).format(cls.baseDailyRate)}
          </p>
          <p className="text-xs text-muted-foreground">per day, before taxes</p>
        </div>
        <Button
          onClick={onSelect}
          disabled={isUnavailable}
          aria-label={
            isUnavailable
              ? `${cls.className} — sold out`
              : `Select ${cls.className} at ${cls.baseDailyRate} per day`
          }
        >
          {isUnavailable ? 'Unavailable' : 'Select'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function SearchSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Loading available vehicles"
      aria-busy="true"
    >
      {[...Array(6)].map((_, i) => (
        <Card key={i}>
          <div className="aspect-[16/9] animate-pulse rounded-t-lg bg-muted" />
          <CardHeader>
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[...Array(3)].map((_, j) => (
              <div key={j} className="h-4 w-full animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
          <CardFooter className="justify-between">
            <div className="h-8 w-20 animate-pulse rounded bg-muted" />
            <div className="h-11 w-24 animate-pulse rounded bg-muted" />
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

export { SearchSkeleton }
