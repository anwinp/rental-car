import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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
  StepperRoot,
  StepperList,
  StepperItem,
  StepperContent,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'
import { useCounterStore } from '../store/counterStore'
import { AvailabilityGrid } from '../components/AvailabilityGrid'

const EXTRAS = [
  { code: 'CDW', name: 'Collision Damage Waiver', dailyRate: 19.99 },
  { code: 'GPS', name: 'GPS Navigation', dailyRate: 7.99 },
  { code: 'CSS', name: 'Child Safety Seat', dailyRate: 9.99 },
  { code: 'PAI', name: 'Personal Accident Insurance', dailyRate: 4.99 },
  { code: 'RSN', name: 'Roadside Assistance', dailyRate: 3.99 },
]

const STEPS = [
  { label: 'Find Customer' },
  { label: 'DNR Check' },
  { label: 'Assign Vehicle' },
  { label: 'Extras' },
  { label: 'Pre-Auth & Sign' },
  { label: 'Agreement' },
]

type Customer = {
  customer_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  is_dnr: boolean
  dnr_reason?: string
  loyalty_tier?: string
  total_rentals: number
}

const agreementSchema = z.object({
  email_ra_to: z.string().email('Please enter a valid email address'),
})
type AgreementForm = z.infer<typeof agreementSchema>

const LOCATION_ID = 'loc-001' // Would come from session/context in production

export function CheckoutPage() {
  const [activeStep, setActiveStep] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedVehicleClassId, setSelectedVehicleClassId] = useState<string | null>(null)
  const [selectedExtras, setSelectedExtras] = useState<string[]>([])
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const addToQueue = useCounterStore((s) => s.addToQueue)

  const agreementForm = useForm<AgreementForm>({
    resolver: zodResolver(agreementSchema),
    defaultValues: { email_ra_to: selectedCustomer?.email ?? '' },
  })

  // Customer search
  const { data: customers, isFetching: searchFetching } = useQuery({
    queryKey: ['customers', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      const { data } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown }>
      }).GET('/customers', { params: { query: { q: searchQuery, page_size: 10 } } })
      return ((data as { items: Customer[] })?.items ?? [])
    },
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  })

  function toggleExtra(code: string) {
    setSelectedExtras((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    )
  }

  // Canvas signature pad
  function startDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    setIsDrawing(true)
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }

  function endDraw() {
    if (!isDrawing) return
    setIsDrawing(false)
    const canvas = canvasRef.current
    if (canvas) {
      setSignatureData(canvas.toDataURL())
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureData(null)
  }

  async function handleCheckout(data: AgreementForm) {
    if (!selectedCustomer || !selectedVehicleClassId) return

    const payload = {
      reservation_id: 'walk-in',
      vehicle_id: selectedVehicleClassId,
      odometer_out: 0,
      fuel_level_out: 8,
      extras: selectedExtras,
      signature_data: signatureData ?? undefined,
      email_ra_to: data.email_ra_to,
    }

    if (!navigator.onLine) {
      addToQueue({
        url: '/api/v1/counter/checkout',
        body: JSON.stringify(payload),
        timestamp: Date.now(),
      })
      alert('Checkout queued — will sync when online')
      return
    }

    try {
      await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<unknown>
      }).POST('/counter/checkout', { body: payload })
      alert('Checkout complete!')
    } catch {
      alert('Checkout failed. Please try again.')
    }
  }

  const extrasTotal = selectedExtras.reduce((sum, code) => {
    const extra = EXTRAS.find((e) => e.code === code)
    return sum + (extra?.dailyRate ?? 0)
  }, 0)

  return (
    <div className="p-4">
      <h1 className="mb-6 text-2xl font-bold">Counter Checkout</h1>

      <StepperRoot
        activeStep={activeStep}
        totalSteps={STEPS.length}
        onStepChange={setActiveStep}
      >
        <StepperList aria-label="Checkout steps" className="flex-wrap gap-1">
          {STEPS.map((step, i) => (
            <StepperItem
              key={i}
              step={i}
              label={step.label}
              disabled={i > activeStep}
            />
          ))}
        </StepperList>

        {/* Step 0: Find Customer */}
        <StepperContent step={0}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Search Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="customer-search" className="text-sm font-medium">
                  Name, email, or phone
                </label>
                <Input
                  id="customer-search"
                  type="search"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search for customer"
                />
              </div>

              {searchFetching && (
                <div aria-busy="true" aria-label="Searching...">
                  <Skeleton variant="text" />
                </div>
              )}

              {customers && customers.length > 0 && (
                <ul role="listbox" aria-label="Customer results" className="space-y-2">
                  {customers.map((customer) => (
                    <li key={customer.customer_id}>
                      <button
                        role="option"
                        aria-selected={selectedCustomer?.customer_id === customer.customer_id}
                        onClick={() => setSelectedCustomer(customer)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted min-h-[44px] ${
                          selectedCustomer?.customer_id === customer.customer_id
                            ? 'border-primary bg-primary/5'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">
                              {customer.first_name} {customer.last_name}
                            </p>
                            <p className="text-sm text-muted-foreground">{customer.email}</p>
                          </div>
                          <div className="flex gap-2">
                            {customer.is_dnr && (
                              <Badge variant="destructive" aria-label="Do Not Rent flagged">
                                DNR
                              </Badge>
                            )}
                            {customer.loyalty_tier && (
                              <Badge variant="outline">{customer.loyalty_tier}</Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {customers?.length === 0 && searchQuery.length >= 2 && (
                <p className="text-sm text-muted-foreground">No customers found matching &ldquo;{searchQuery}&rdquo;</p>
              )}
            </CardContent>
            <CardFooter className="justify-end">
              <Button
                onClick={() => setActiveStep(1)}
                disabled={!selectedCustomer}
              >
                Continue
              </Button>
            </CardFooter>
          </Card>
        </StepperContent>

        {/* Step 1: DNR Check */}
        <StepperContent step={1}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>DNR Check</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedCustomer?.is_dnr ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4"
                >
                  <div className="flex items-center gap-2 font-bold text-destructive">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="15" y1="9" x2="9" y2="15"/>
                      <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    DO NOT RENT
                  </div>
                  <p className="mt-2 text-sm text-destructive">
                    <strong>Reason:</strong> {selectedCustomer.dnr_reason ?? 'No reason provided.'}
                  </p>
                  <p className="mt-2 text-sm text-destructive font-medium">
                    This customer is flagged as Do Not Rent. You cannot proceed with checkout.
                    Contact your manager if you believe this is an error.
                  </p>
                </div>
              ) : (
                <div
                  role="status"
                  className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Customer cleared
                  </div>
                  <p className="mt-1 text-sm">
                    {selectedCustomer?.first_name} {selectedCustomer?.last_name} has no DNR flags.
                    Rental history: {selectedCustomer?.total_rentals ?? 0} rentals.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setActiveStep(0)}>Back</Button>
              <Button
                onClick={() => setActiveStep(2)}
                disabled={selectedCustomer?.is_dnr}
              >
                Continue
              </Button>
            </CardFooter>
          </Card>
        </StepperContent>

        {/* Step 2: Assign Vehicle */}
        <StepperContent step={2}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Select Vehicle Class</CardTitle>
            </CardHeader>
            <CardContent>
              <AvailabilityGrid
                locationId={LOCATION_ID}
                onClassSelect={(classId) => {
                  setSelectedVehicleClassId(classId)
                  setActiveStep(3)
                }}
              />
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setActiveStep(1)}>Back</Button>
            </CardFooter>
          </Card>
        </StepperContent>

        {/* Step 3: Extras */}
        <StepperContent step={3}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Add Extras</CardTitle>
            </CardHeader>
            <CardContent>
              <fieldset>
                <legend className="sr-only">Optional extras</legend>
                <div className="space-y-2">
                  {EXTRAS.map((extra) => {
                    const checked = selectedExtras.includes(extra.code)
                    return (
                      <label
                        key={extra.code}
                        className="flex cursor-pointer items-center justify-between rounded-lg border p-3 hover:bg-muted/50 has-[:checked]:border-primary"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExtra(extra.code)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="font-medium text-sm">{extra.name}</span>
                        </div>
                        <span className="text-sm font-semibold">${extra.dailyRate}/day</span>
                      </label>
                    )
                  })}
                </div>
                {extrasTotal > 0 && (
                  <div className="mt-4 rounded bg-muted/50 p-3 text-sm">
                    <div className="flex justify-between font-medium">
                      <span>Extras total</span>
                      <span>${extrasTotal.toFixed(2)}/day</span>
                    </div>
                  </div>
                )}
              </fieldset>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setActiveStep(2)}>Back</Button>
              <Button onClick={() => setActiveStep(4)}>Continue</Button>
            </CardFooter>
          </Card>
        </StepperContent>

        {/* Step 4: Pre-Auth & Signature */}
        <StepperContent step={4}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Pre-Authorization & Signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Pre-auth confirmation */}
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-medium">Pre-authorization amount</p>
                <p className="mt-1 text-2xl font-bold">$350.00</p>
                <p className="mt-1 text-muted-foreground">
                  Estimated hold — final charge calculated at return
                </p>
              </div>

              {/* Signature pad */}
              <div>
                <p className="mb-2 text-sm font-medium">Customer Signature</p>
                <div className="rounded-lg border bg-white">
                  <canvas
                    ref={canvasRef}
                    width={480}
                    height={160}
                    className="block w-full cursor-crosshair touch-none rounded-lg"
                    aria-label="Signature pad — draw your signature"
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" size="sm" onClick={clearSignature}>
                    Clear Signature
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setActiveStep(3)}>Back</Button>
              <Button onClick={() => setActiveStep(5)} disabled={!signatureData}>
                Continue to Agreement
              </Button>
            </CardFooter>
          </Card>
        </StepperContent>

        {/* Step 5: Agreement & Email */}
        <StepperContent step={5}>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Rental Agreement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-48 overflow-y-auto rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-semibold mb-2">RENTAL AGREEMENT TERMS</p>
                <p>By completing this checkout, the customer agrees to the terms and conditions of the rental agreement, including but not limited to: fuel policy, mileage limits, geographic restrictions, insurance requirements, and return conditions. The customer accepts liability for any damage caused during the rental period not covered by selected protection products...</p>
                <p className="mt-2">[Full agreement text would be displayed here]</p>
              </div>

              <form
                id="agreement-form"
                onSubmit={agreementForm.handleSubmit(handleCheckout)}
                noValidate
                className="space-y-2"
              >
                <label htmlFor="email-ra" className="text-sm font-medium">
                  Email Rental Agreement to
                </label>
                <Input
                  id="email-ra"
                  type="email"
                  placeholder="customer@example.com"
                  defaultValue={selectedCustomer?.email}
                  {...agreementForm.register('email_ra_to')}
                  aria-describedby={
                    agreementForm.formState.errors.email_ra_to ? 'email-ra-error' : undefined
                  }
                  aria-invalid={!!agreementForm.formState.errors.email_ra_to}
                />
                {agreementForm.formState.errors.email_ra_to && (
                  <p
                    id="email-ra-error"
                    role="alert"
                    aria-live="polite"
                    className="text-xs text-destructive"
                  >
                    {agreementForm.formState.errors.email_ra_to.message}
                  </p>
                )}
              </form>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setActiveStep(4)}>Back</Button>
              <Button type="submit" form="agreement-form">
                Complete Checkout
              </Button>
            </CardFooter>
          </Card>
        </StepperContent>
      </StepperRoot>
    </div>
  )
}
