'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@rcm/ui'

interface ConfirmationDetailsProps {
  confirmationNumber: string
}

export function ConfirmationDetails({ confirmationNumber }: ConfirmationDetailsProps) {
  // Fetch reservation by confirmation number via manage token path
  const { data: managed, isLoading, isError } = useQuery({
    queryKey: ['managed', confirmationNumber],
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/manage/{token}', {
        params: { path: { token: confirmationNumber } },
      })
      if (error) throw error
      return data as {
        reservation: {
          reservation_id: string
          confirmation_number: string
          status: string
          pickup_date: string
          dropoff_date: string
          class_name: string
          customer: { first_name: string; last_name: string; email: string }
          rate_summary: { total: number; currency_code: string }
        }
        invoice_url?: string
      }
    },
    retry: false,
  })

  if (isLoading) {
    return (
      <Card aria-busy="true" aria-label="Loading confirmation">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError || !managed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reservation Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find a reservation with confirmation number{' '}
            <strong>{confirmationNumber}</strong>. Please check the number and try again.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline">
            <a href="/">Back to Home</a>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const res = managed.reservation

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-700"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Booking Confirmed</h1>
          <p className="text-muted-foreground">
            Confirmation #{res.confirmation_number}
          </p>
        </div>
      </div>

      {/* Reservation Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{res.class_name}</CardTitle>
            <Badge variant="success">{res.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-muted-foreground">Pickup</dt>
              <dd className="mt-1">{new Date(res.pickup_date).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Return</dt>
              <dd className="mt-1">{new Date(res.dropoff_date).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Primary Driver</dt>
              <dd className="mt-1">{res.customer.first_name} {res.customer.last_name}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Total</dt>
              <dd className="mt-1 font-semibold">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: res.rate_summary.currency_code,
                }).format(res.rate_summary.total)}
              </dd>
            </div>
          </dl>
        </CardContent>
        <CardFooter className="flex-wrap gap-3">
          <Button asChild variant="outline" size="sm">
            <a href={`/manage/${confirmationNumber}`}>Manage Booking</a>
          </Button>
          {managed.invoice_url && (
            <Button asChild variant="outline" size="sm">
              <a href={managed.invoice_url} target="_blank" rel="noreferrer">
                Download Receipt (PDF)
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Add to calendar — generates ICS stub
              const start = new Date(res.pickup_date).toISOString().replace(/[-:]/g, '').split('.')[0]
              const end = new Date(res.dropoff_date).toISOString().replace(/[-:]/g, '').split('.')[0]
              const ics = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'BEGIN:VEVENT',
                `DTSTART:${start}Z`,
                `DTEND:${end}Z`,
                `SUMMARY:Rental Car Pickup - ${res.class_name}`,
                `DESCRIPTION:Confirmation #${res.confirmation_number}`,
                'END:VEVENT',
                'END:VCALENDAR',
              ].join('\n')
              const blob = new Blob([ics], { type: 'text/calendar' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `rental-${res.confirmation_number}.ics`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Add to Calendar
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
