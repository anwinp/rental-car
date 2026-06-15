import { Card, CardContent, CardFooter, CardHeader } from '@rcm/ui'

export function SearchSkeleton() {
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
