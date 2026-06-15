import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30 seconds
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000), // exponential, cap 30s
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,                 // mutations never retry by default
    },
  },
})
