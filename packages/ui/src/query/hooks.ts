/**
 * Generic typed query/mutation wrappers built on TanStack Query v5.
 * Use these for one-off API calls; for common endpoints use @rcm/api-client hooks.
 */
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import type { paths } from '@rcm/api-client'

// Infer GET paths from the schema
type GetPaths = {
  [P in keyof paths]: paths[P] extends { get: unknown } ? P : never
}[keyof paths]

// Infer 200 response for a GET path
type GetResponse<TPath extends GetPaths> = paths[TPath] extends {
  get: { responses: { 200: { content: { 'application/json': infer D } } } }
}
  ? D
  : unknown

/**
 * Generic typed GET query wrapper — path and response type inferred from generated schema.
 * @example
 * const { data } = useApiQuery('/auth/me')
 */
export function useApiQuery<
  TPath extends GetPaths,
  TData = GetResponse<TPath>,
>(
  path: TPath,
  params?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<TData>, 'queryKey' | 'queryFn'>
) {
  return useQuery<TData>({
    queryKey: [path, params],
    queryFn: () =>
      (apiClient as never as {
        GET: (p: string, o: unknown) => Promise<{ data: TData }>
      })
        .GET(path as string, { params })
        .then(({ data }) => data),
    ...options,
  })
}

/**
 * Generic typed mutation wrapper.
 * @example
 * const mutation = useApiMutation<LoginRequest, LoginResponse>('POST', '/auth/login')
 */
export function useApiMutation<TBody, TData = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options?: UseMutationOptions<TData, Error, TBody>
) {
  return useMutation<TData, Error, TBody>({
    mutationFn: (body) =>
      (apiClient as never as {
        [K: string]: (p: string, o: { body: TBody }) => Promise<{ data: TData }>
      })[method](path, { body }).then(({ data }) => data),
    ...options,
  })
}
