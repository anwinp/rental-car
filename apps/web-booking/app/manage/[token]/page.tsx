'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Skeleton,
} from '@rcm/ui'
import { Providers } from '../../providers'

interface ManagePageProps {
  params: { token: string }
}

type ManagedReservation = {
  reservation: {
    reservation_id: string
    confirmation_number: string
    status: string
    pickup_date: string
    dropoff_date: string
    class_name: string
    customer: { first_name: string; last_name: string; email: string }
    rate_summary: { total: number; currency_code: string }
    extras: Array<{ code: string; name: string; daily_rate: number }>
  }
  can_modify: boolean
  can_cancel: boolean
  modification_deadline?: string
  cancellation_deadline?: string
  invoice_url?: string
}

function ManageContent({ token }: { token: string }) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelConfirmed, setCancelConfirmed] = useState(false)

  const { data: managed, isLoading, isError } = useQuery({
    queryKey: ['managed', token],
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/manage/{token}', {
        params: { path: { token } },
      })
      if (error) throw error
      return data as ManagedReservation
    },
    retry: false,
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!managed) return
      await (apiClient as never as {
        DELETE: (path: string, opts: unknown) => Promise<{ error: unknown }>
      }).DELETE('/reservations/{reservationId}', {
        params: { path: { reservationId: managed.reservation.reservation_id } },
      })
    },
    onSuccess: () => {
      setCancelConfirmed(true)
      setCancelDialogOpen(false)
    },
  })

  if (isLoading) {
    return (
      <Card aria-busy="true" aria-label="Loading reservation">
        <CardHeader>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            This booking link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Please check your email for a valid manage booking link, or contact support.
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

  if (cancelConfirmed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Booking Cancelled</CardTitle>
          <CardDescription>
            Your reservation #{managed?.reservation.confirmation_number} has been cancelled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Any applicable refund will be processed within 5-7 business days.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild>
            <a href="/">Book a New Car</a>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (!managed) return null

  const res = managed.reservation

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Your Booking</h1>
        <p className="text-muted-foreground">Confirmation #{res.confirmation_number}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{res.class_name}</CardTitle>
              <CardDescription>
                {res.customer.first_name} {res.customer.last_name} · {res.customer.email}
              </CardDescription>
            </div>
            <Badge
              variant={
                res.status === 'CONFIRMED'
                  ? 'success'
                  : res.status === 'CANCELLED'
                  ? 'destructive'
                  : 'default'
              }
            >
              {res.status}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-muted-foreground">Pickup Date</dt>
              <dd className="mt-1">{new Date(res.pickup_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Return Date</dt>
              <dd className="mt-1">{new Date(res.dropoff_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            {res.extras.length > 0 && (
              <div className="col-span-2">
                <dt className="font-medium text-muted-foreground">Extras</dt>
                <dd className="mt-1">
                  {res.extras.map((e) => e.name).join(', ')}
                </dd>
              </div>
            )}
            <div className="col-span-2">
              <dt className="font-medium text-muted-foreground">Total</dt>
              <dd className="mt-1 text-lg font-semibold">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: res.rate_summary.currency_code,
                }).format(res.rate_summary.total)}
              </dd>
            </div>
          </dl>

          {/* Modification constraints */}
          {managed.modification_deadline && managed.can_modify && (
            <p className="mt-4 text-xs text-muted-foreground">
              You can modify this booking until{' '}
              {new Date(managed.modification_deadline).toLocaleString()}.
            </p>
          )}
          {managed.cancellation_deadline && managed.can_cancel && (
            <p className="mt-1 text-xs text-muted-foreground">
              Free cancellation until{' '}
              {new Date(managed.cancellation_deadline).toLocaleString()}.
            </p>
          )}
        </CardContent>

        <CardFooter className="flex-wrap gap-3">
          {managed.invoice_url && (
            <Button asChild variant="outline" size="sm">
              <a href={managed.invoice_url} target="_blank" rel="noreferrer">
                Download Invoice
              </a>
            </Button>
          )}

          {managed.can_modify && (
            <Button variant="outline" size="sm" disabled>
              Modify Dates
              <span className="sr-only">(coming soon)</span>
            </Button>
          )}

          {managed.can_cancel && (
            <DialogRoot open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Cancel Booking
                </Button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Cancel Your Booking?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  This action cannot be undone. Your reservation{' '}
                  <strong>#{res.confirmation_number}</strong> will be cancelled.
                </p>
                {cancelMutation.isError && (
                  <div role="alert" aria-live="polite" className="rounded text-sm text-destructive bg-destructive/10 px-3 py-2">
                    Cancellation failed. Please try again.
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
                    Keep Booking
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    aria-busy={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Yes, Cancel'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </DialogRoot>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default function ManagePage({ params }: ManagePageProps) {
  return (
    <Providers>
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <ManageContent token={params.token} />
        </div>
      </div>
    </Providers>
  )
}
