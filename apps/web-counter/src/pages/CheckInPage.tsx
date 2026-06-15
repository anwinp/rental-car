import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient, useCheckIn } from '@rcm/api-client'
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'

type ActiveRental = {
  rental_agreement_id: string
  reservation: {
    confirmation_number: string
    class_name: string
    customer: { first_name: string; last_name: string; email: string }
    pickup_date: string
    dropoff_date: string
    rate_summary: { total: number; currency_code: string }
  }
  vehicle: { plate: string; make: string; model: string }
  odometer_out: number
  fuel_level_out: number
}

function FuelSlider({
  value,
  onChange,
  id,
}: {
  value: number
  onChange: (v: number) => void
  id: string
}) {
  const labels = ['E', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'F']
  return (
    <div>
      <input
        id={id}
        type="range"
        min={0}
        max={8}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label="Fuel level (0 = Empty, 8 = Full)"
        aria-valuetext={labels[value]}
      />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

export function CheckInPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeRental, setActiveRental] = useState<ActiveRental | null>(null)
  const [odometerIn, setOdometerIn] = useState('')
  const [fuelLevelIn, setFuelLevelIn] = useState(8)
  const [completed, setCompleted] = useState(false)

  const checkIn = useCheckIn()

  // Search for active rental by RA number or customer name
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['rentals', 'active', searchQuery],
    queryFn: async () => {
      // In production this would hit a dedicated active-rentals search endpoint
      const { data } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown }>
      }).GET('/customers', { params: { query: { q: searchQuery, page_size: 5 } } })
      return data
    },
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  })

  async function handleCheckIn() {
    if (!activeRental || !odometerIn) return

    try {
      await checkIn.mutateAsync({
        rental_agreement_id: activeRental.rental_agreement_id,
        odometer_in: Number(odometerIn),
        fuel_level_in: fuelLevelIn,
      })
      setCompleted(true)
    } catch {
      // Error surfaced by mutation state
    }
  }

  if (completed) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-green-700">Check-In Complete</CardTitle>
            <CardDescription>
              Vehicle returned and payment processed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">RA #{activeRental?.rental_agreement_id} has been successfully checked in.</p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => {
              setCompleted(false)
              setActiveRental(null)
              setSearchQuery('')
              setOdometerIn('')
              setFuelLevelIn(8)
            }}>
              New Check-In
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Vehicle Check-In</h1>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Find Rental</CardTitle>
          <CardDescription>Search by RA number or customer name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="rental-search" className="text-sm font-medium">
              RA Number or Customer Name
            </label>
            <Input
              id="rental-search"
              type="search"
              placeholder="RA-12345 or John Smith..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {isFetching && (
            <div aria-busy="true" aria-label="Searching...">
              <Skeleton variant="text" />
            </div>
          )}

          {/* Mock active rental result for demo */}
          {searchQuery.length >= 2 && !isFetching && (
            <div className="space-y-2">
              <button
                onClick={() =>
                  setActiveRental({
                    rental_agreement_id: `RA-${searchQuery.toUpperCase()}`,
                    reservation: {
                      confirmation_number: `CNF-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
                      class_name: 'Economy',
                      customer: { first_name: 'Demo', last_name: 'Customer', email: 'demo@example.com' },
                      pickup_date: new Date(Date.now() - 86400000 * 3).toISOString(),
                      dropoff_date: new Date().toISOString(),
                      rate_summary: { total: 247.50, currency_code: 'USD' },
                    },
                    vehicle: { plate: 'ABC-1234', make: 'Toyota', model: 'Corolla' },
                    odometer_out: 15420,
                    fuel_level_out: 8,
                  })
                }
                className="w-full rounded-lg border p-3 text-left hover:bg-muted transition-colors min-h-[44px]"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">RA-{searchQuery.toUpperCase()}</p>
                    <p className="text-sm text-muted-foreground">Demo Customer · Economy</p>
                  </div>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">ON RENT</span>
                </div>
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Return details */}
      {activeRental && (
        <Card>
          <CardHeader>
            <CardTitle>Return Details</CardTitle>
            <CardDescription>
              {activeRental.vehicle.make} {activeRental.vehicle.model} · {activeRental.vehicle.plate}
              <br />
              Customer: {activeRental.reservation.customer.first_name} {activeRental.reservation.customer.last_name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Odometer in */}
            <div className="space-y-1">
              <label htmlFor="odometer-in" className="text-sm font-medium">
                Odometer Reading (in)
                <span className="ml-2 text-xs text-muted-foreground">
                  (Out: {activeRental.odometer_out.toLocaleString()} km)
                </span>
              </label>
              <Input
                id="odometer-in"
                type="number"
                min={activeRental.odometer_out}
                value={odometerIn}
                onChange={(e) => setOdometerIn(e.target.value)}
                placeholder={String(activeRental.odometer_out)}
                aria-label="Current odometer reading"
              />
              {odometerIn && Number(odometerIn) > activeRental.odometer_out && (
                <p className="text-xs text-muted-foreground">
                  Distance: {(Number(odometerIn) - activeRental.odometer_out).toLocaleString()} km
                </p>
              )}
            </div>

            {/* Fuel level */}
            <div className="space-y-2">
              <label htmlFor="fuel-in" className="text-sm font-medium">
                Fuel Level (in)
                <span className="ml-2 text-xs text-muted-foreground">
                  (Out: {['E','1/8','1/4','3/8','1/2','5/8','3/4','7/8','F'][activeRental.fuel_level_out]})
                </span>
              </label>
              <FuelSlider id="fuel-in" value={fuelLevelIn} onChange={setFuelLevelIn} />
            </div>

            {/* Estimated charges */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <p className="font-medium">Estimated Charges</p>
              <div className="flex justify-between">
                <span>Base rental</span>
                <span>$247.50</span>
              </div>
              {fuelLevelIn < activeRental.fuel_level_out && (
                <div className="flex justify-between text-amber-600">
                  <span>Fuel surcharge ({activeRental.fuel_level_out - fuelLevelIn} notches)</span>
                  <span>${((activeRental.fuel_level_out - fuelLevelIn) * 12.50).toFixed(2)}</span>
                </div>
              )}
              {odometerIn && Number(odometerIn) - activeRental.odometer_out > 200 && (
                <div className="flex justify-between text-amber-600">
                  <span>Excess mileage</span>
                  <span>
                    ${((Number(odometerIn) - activeRental.odometer_out - 200) * 0.15).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>Total due</span>
                <span>
                  $
                  {(
                    247.5 +
                    (fuelLevelIn < activeRental.fuel_level_out
                      ? (activeRental.fuel_level_out - fuelLevelIn) * 12.5
                      : 0) +
                    (odometerIn && Number(odometerIn) - activeRental.odometer_out > 200
                      ? (Number(odometerIn) - activeRental.odometer_out - 200) * 0.15
                      : 0)
                  ).toFixed(2)}
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setActiveRental(null)}>
              Back to Search
            </Button>
            <Button
              onClick={handleCheckIn}
              disabled={!odometerIn || checkIn.isPending}
              aria-busy={checkIn.isPending}
            >
              {checkIn.isPending ? 'Processing…' : 'Confirm Check-In & Capture Payment'}
            </Button>
          </CardFooter>

          {checkIn.isError && (
            <div
              role="alert"
              aria-live="polite"
              className="mx-6 mb-4 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              Check-in failed. Please try again or contact support.
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
