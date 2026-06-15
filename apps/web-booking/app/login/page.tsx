'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '@rcm/api-client'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Separator,
} from '@rcm/ui'
import { Input } from '@rcm/ui'
import { Providers } from '../providers'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

const magicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type MagicLinkForm = z.infer<typeof magicLinkSchema>

function LoginContent() {
  const [loginError, setLoginError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'password' | 'magic'>('password')

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const magicForm = useForm<MagicLinkForm>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: '' },
  })

  async function onLogin(data: LoginForm) {
    setLoginError(null)
    setIsSubmitting(true)
    try {
      await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/auth/login', { body: data })
      window.location.href = '/'
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onMagicLink(data: MagicLinkForm) {
    setIsSubmitting(true)
    try {
      // Stub: would call /auth/magic-link in a real implementation
      await new Promise((r) => setTimeout(r, 800))
      setMagicLinkSent(true)
      void data
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>

        <Card>
          <CardHeader>
            {/* Tab switcher */}
            <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
              <button
                role="tab"
                aria-selected={activeTab === 'password'}
                onClick={() => setActiveTab('password')}
                className={`flex-1 rounded py-2 text-sm font-medium transition-colors min-h-[44px] ${
                  activeTab === 'password'
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Password
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'magic'}
                onClick={() => setActiveTab('magic')}
                className={`flex-1 rounded py-2 text-sm font-medium transition-colors min-h-[44px] ${
                  activeTab === 'magic'
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Magic Link
              </button>
            </div>
          </CardHeader>

          <CardContent>
            {activeTab === 'password' ? (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onLogin)}
                  noValidate
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              autoComplete="email"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div>
                            <Input
                              type="password"
                              autoComplete="current-password"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {loginError && (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {loginError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                  >
                    {isSubmitting ? 'Signing in…' : 'Sign In'}
                  </Button>
                </form>
              </Form>
            ) : (
              <>
                {magicLinkSent ? (
                  <div className="py-4 text-center" role="status" aria-live="polite">
                    <div className="flex justify-center text-4xl">✉️</div>
                    <p className="mt-4 font-semibold">Check your email</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      We sent a sign-in link to{' '}
                      <strong>{magicForm.getValues('email')}</strong>. It expires in 15 minutes.
                    </p>
                  </div>
                ) : (
                  <Form {...magicForm}>
                    <form
                      onSubmit={magicForm.handleSubmit(onMagicLink)}
                      noValidate
                      className="space-y-4"
                    >
                      <FormField
                        control={magicForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <div>
                                <Input
                                  type="email"
                                  placeholder="you@example.com"
                                  autoComplete="email"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                        aria-busy={isSubmitting}
                      >
                        {isSubmitting ? 'Sending…' : 'Send Magic Link'}
                      </Button>
                    </form>
                  </Form>
                )}
              </>
            )}

            <div className="my-4 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            {/* Google Sign-In stub */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                // Stub: redirect to OAuth flow
                window.location.href = '/api/v1/auth/google'
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                className="mr-2"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>
          </CardContent>

          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              No account?{' '}
              <a
                href="/"
                className="text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Book as guest
              </a>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Providers>
      <LoginContent />
    </Providers>
  )
}
