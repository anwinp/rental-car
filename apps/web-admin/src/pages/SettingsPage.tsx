import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  Separator,
} from '@rcm/ui'
import { Input } from '@rcm/ui'

function StubTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            Configuration form coming soon
          </div>
        </CardContent>
        <CardFooter>
          <Button disabled>Save Changes</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your company profile and system configuration.</p>
      </div>

      <TabsRoot defaultValue="company">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="company">Company Profile</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* Company Profile */}
        <TabsContent value="company">
          <div className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Company Information</CardTitle>
                <CardDescription>
                  Basic details shown to customers and on rental agreements.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Company Name', placeholder: 'ACME Rentals' },
                    { label: 'Trading Name', placeholder: 'ACME Car Hire' },
                    { label: 'Phone', placeholder: '+1-555-000-0000' },
                    { label: 'Email', placeholder: 'info@acme.com' },
                  ].map(({ label, placeholder }) => (
                    <div key={label} className="space-y-1">
                      <label className="text-sm font-medium">{label}</label>
                      <Input placeholder={placeholder} />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-1">
                  <label className="text-sm font-medium">Business Address</label>
                  <Input placeholder="123 Main St, City, State, ZIP" />
                </div>
              </CardContent>
              <CardFooter>
                <Button>Save Company Profile</Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="locations">
          <StubTab
            title="Location Management"
            description="Add, edit, or deactivate rental locations."
          />
        </TabsContent>

        <TabsContent value="staff">
          <StubTab
            title="Staff & User Management"
            description="Manage staff accounts, roles, and access permissions."
          />
        </TabsContent>

        <TabsContent value="notifications">
          <StubTab
            title="Notification Templates"
            description="Customize email and SMS templates for confirmations, reminders, and receipts."
          />
        </TabsContent>

        <TabsContent value="integrations">
          <div className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Integrations</CardTitle>
                <CardDescription>Connect external services and APIs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { name: 'Stripe', status: 'Connected', description: 'Payment processing' },
                  { name: 'Twilio', status: 'Not connected', description: 'SMS notifications' },
                  { name: 'SendGrid', status: 'Connected', description: 'Email delivery' },
                  { name: 'Google Analytics', status: 'Not connected', description: 'Web analytics' },
                ].map((integration) => (
                  <div
                    key={integration.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{integration.name}</p>
                      <p className="text-sm text-muted-foreground">{integration.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-medium ${
                          integration.status === 'Connected' ? 'text-green-600' : 'text-muted-foreground'
                        }`}
                      >
                        {integration.status}
                      </span>
                      <Button variant="outline" size="sm">
                        {integration.status === 'Connected' ? 'Configure' : 'Connect'}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <StubTab
            title="Billing & Subscription"
            description="Manage your subscription plan, usage limits, and payment method."
          />
        </TabsContent>
      </TabsRoot>
    </div>
  )
}
