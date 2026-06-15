import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from '@rcm/ui'

interface KpiCardProps {
  label: string
  value: string
  trend?: string
  trendUp?: boolean
}

function KpiCard({ label, value, trend, trendUp }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dl>
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-3xl font-bold">{value}</dd>
          {trend && (
            <dd className={`mt-1 flex items-center gap-1 text-xs ${trendUp ? 'text-green-600' : 'text-red-500'}`}>
              <span aria-hidden>{trendUp ? '↑' : '↓'}</span>
              {trend}
            </dd>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}

const QUICK_REPORTS = [
  { label: 'Fleet Utilization', description: 'Vehicle availability vs. on-rent ratio by location' },
  { label: 'Revenue by Category', description: 'Breakdown of revenue by vehicle class' },
  { label: 'Damage Claims', description: 'Open and closed damage claims report' },
]

export function ReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground mt-1">Overview of operations and performance</p>
      </div>

      {/* KPI Cards */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="mb-4 text-lg font-semibold">Today&apos;s KPIs</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Revenue Today"
            value="$12,840"
            trend="+8.3% vs yesterday"
            trendUp
          />
          <KpiCard
            label="Utilization"
            value="74.2%"
            trend="+3.1% vs last week"
            trendUp
          />
          <KpiCard
            label="ADR"
            value="$67.50"
            trend="-2.4% vs last month"
            trendUp={false}
          />
          <KpiCard
            label="Active Rentals"
            value="48"
            trend="+5 vs yesterday"
            trendUp
          />
        </div>
      </section>

      {/* Revenue Chart Placeholder */}
      <section aria-labelledby="chart-heading">
        <h2 id="chart-heading" className="mb-4 text-lg font-semibold">Revenue — Last 30 Days</h2>
        <Card>
          <CardContent className="p-0">
            <div
              className="flex h-64 items-center justify-center rounded-lg bg-muted/30 text-muted-foreground"
              role="img"
              aria-label="Revenue chart placeholder — react-chartjs-2 integration pending"
            >
              <div className="text-center">
                <p className="font-medium">Revenue Chart</p>
                <p className="text-xs mt-1">react-chartjs-2 integration coming in the next sprint</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Quick Reports */}
      <section aria-labelledby="quick-reports-heading">
        <h2 id="quick-reports-heading" className="mb-4 text-lg font-semibold">Quick Reports</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {QUICK_REPORTS.map((report) => (
            <Card key={report.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{report.label}</CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled>
                    View
                  </Button>
                  <Button variant="outline" size="sm" disabled>
                    Export CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
