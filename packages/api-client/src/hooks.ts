/**
 * Typed TanStack Query hook wrappers for key API endpoints.
 * These are convenience wrappers — use apiClient directly for less common paths.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { components } from './schema'

/** Params for the public /fleet/search endpoint. */
export interface SearchParams {
  pickup_location_id: string
  dropoff_location_id?: string
  pickup_date: string
  dropoff_date: string
}
type RateQuoteRequest = components['schemas']['RateQuoteRequest']
type ReservationCreate = components['schemas']['ReservationCreate']
type CheckoutRequest = components['schemas']['CheckoutRequest']
type CheckInRequest = components['schemas']['CheckInRequest']

// Query key factory for consistent cache keys
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,
  availability: (params: SearchParams) => ['fleet', 'search', params] as const,
  rateQuote: (params: RateQuoteRequest) => ['pricing', 'quote', params] as const,
  reservations: (filters?: Record<string, unknown>) =>
    ['reservations', filters] as const,
  reservation: (id: string) => ['reservations', id] as const,
  customers: (q?: string) => ['customers', q] as const,
  customer: (id: string) => ['customers', id] as const,
  vehicles: (filters?: Record<string, unknown>) => ['fleet', 'vehicles', filters] as const,
  vehicle: (id: string) => ['fleet', 'vehicles', id] as const,
  locations: ['locations'] as const,
  rateCodes: (filters?: Record<string, unknown>) => ['pricing', 'rate-codes', filters] as const,
}

/**
 * Search available vehicle classes for a location + date range.
 * Calls the public /fleet/search endpoint — no auth required.
 * Polls every 30s for live availability updates.
 */
export function useAvailability(params: SearchParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.availability(params),
    queryFn: async () => {
      const qs = new URLSearchParams({ pickup_location_id: params.pickup_location_id, pickup_date: params.pickup_date, dropoff_date: params.dropoff_date })
      if (params.dropoff_location_id) qs.set('dropoff_location_id', params.dropoff_location_id)
      const tenantId = process.env.NEXT_PUBLIC_TENANT_ID
        ?? (typeof window !== 'undefined'
          ? (window.location.hostname.split('.').length >= 3 ? window.location.hostname.split('.')[0] : 'dev')
          : 'dev')
      const res = await fetch(`/api/v1/fleet/search?${qs}`, {
        credentials: 'include',
        headers: { 'X-Tenant-ID': tenantId },
      })
      if (!res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        const msg = ct.includes('application/json') ? ((await res.json()) as { detail?: string }).detail ?? res.statusText : `${res.status} ${res.statusText}`
        throw new Error(msg)
      }
      return res.json() as Promise<{ classes: Array<{ classId: string; classCode: string; className: string; description: string; features: string[]; imageUrl?: string; availableCount: number; baseDailyRate: number; currencyCode: string }> }>
    },
    enabled: enabled && !!params.pickup_location_id && !!params.pickup_date && !!params.dropoff_date,
    staleTime: 25_000,
    refetchInterval: 30_000,
  })
}

/**
 * Get a rate quote (pricing breakdown) for a given booking configuration.
 * Uses POST because the request body is too complex for a GET query string.
 * Only fetches when all required params are populated.
 */
export function useRateQuote(
  params: Partial<RateQuoteRequest> & {
    pickup_location_id?: string
    pickup_date?: string
    dropoff_date?: string
    class_code?: string
  },
  enabled = true
) {
  const isComplete =
    !!params.pickup_location_id &&
    !!params.pickup_date &&
    !!params.dropoff_date &&
    !!params.class_code

  return useQuery({
    queryKey: queryKeys.rateQuote(params as RateQuoteRequest),
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/pricing/quote', {
        body: params,
      })
      if (error) throw error
      return data as components['schemas']['RateQuoteResponse']
    },
    enabled: enabled && isComplete,
    staleTime: 60_000, // Quotes are valid for 60s client-side
  })
}

/**
 * Create a reservation (booking funnel final step).
 * Invalidates reservations list cache on success.
 */
export function useCreateReservation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: ReservationCreate) => {
      const { data, error } = await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/reservations', { body })
      if (error) throw error
      return data as components['schemas']['ReservationResponse']
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
    },
  })
}

/**
 * Get the currently authenticated user.
 * staleTime=Infinity means it won't re-fetch until explicitly invalidated (e.g. on logout).
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts?: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/auth/me')
      if (error) throw error
      return data as components['schemas']['UserProfile']
    },
    staleTime: Infinity,
    retry: false, // Don't retry 401s — just means not logged in
  })
}

/**
 * Counter checkout — submit a checkout with offline queue support.
 */
export function useCheckout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CheckoutRequest) => {
      const { data, error } = await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/checkout/checkout', { body })
      if (error) throw error
      return data as components['schemas']['CheckoutResponse']
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet'] })
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
    },
  })
}

/**
 * Counter check-in — submit vehicle return.
 */
export function useCheckIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CheckInRequest) => {
      const { data, error } = await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/checkout/check-in', { body })
      if (error) throw error
      return data as components['schemas']['CheckInResponse']
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet'] })
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
    },
  })
}
