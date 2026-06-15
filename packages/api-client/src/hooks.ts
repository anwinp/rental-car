/**
 * Typed TanStack Query hook wrappers for key API endpoints.
 * These are convenience wrappers — use apiClient directly for less common paths.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { components } from './schema'

type AvailabilityQuery = components['schemas']['AvailabilityQuery']
type RateQuoteRequest = components['schemas']['RateQuoteRequest']
type ReservationCreate = components['schemas']['ReservationCreate']
type CheckoutRequest = components['schemas']['CheckoutRequest']
type CheckInRequest = components['schemas']['CheckInRequest']

// Query key factory for consistent cache keys
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,
  availability: (params: AvailabilityQuery) => ['fleet', 'availability', params] as const,
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
 * Fetch available vehicle classes for a given location + date range.
 * Polls every 30s as a WebSocket fallback.
 */
export function useAvailability(params: AvailabilityQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.availability(params),
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/fleet/availability', {
        params: { query: params },
      })
      if (error) throw error
      return data as components['schemas']['AvailabilityResponse']
    },
    enabled:
      enabled &&
      !!params.pickup_location_id &&
      !!params.pickup_date &&
      !!params.dropoff_date,
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
      }).POST('/counter/checkout', { body })
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
      }).POST('/counter/check-in', { body })
      if (error) throw error
      return data as components['schemas']['CheckInResponse']
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet'] })
      queryClient.invalidateQueries({ queryKey: ['reservations'] })
    },
  })
}
