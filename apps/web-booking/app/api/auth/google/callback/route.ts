import { NextRequest, NextResponse } from 'next/server'

// Server-side handler — Google redirects here after user grants access.
// We call the FastAPI exchange endpoint server-to-server (no browser CORS),
// then set httpOnly cookies for localhost:3400 before redirecting home.

const TENANT = '00000000-0000-0000-0000-000000000001'
// Internal FastAPI URL — bypasses the Next.js proxy so we talk directly to the API
const API_INTERNAL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('localhost', '127.0.0.1') ?? 'http://127.0.0.1:8000'
// Must exactly match the redirect_uri registered in Google Cloud Console
const REDIRECT_URI = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3400') + '/api/auth/google/callback'
const FRONTEND_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3400'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(new URL('/login?error=oauth_cancelled', FRONTEND_URL))
  }

  try {
    const exchangeResp = await fetch(`${API_INTERNAL}/api/v1/auth/google/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': TENANT,
      },
      body: JSON.stringify({ code, state, redirect_uri: REDIRECT_URI }),
    })

    if (!exchangeResp.ok) {
      const err = await exchangeResp.json().catch(() => ({}))
      console.error('[google/callback] exchange failed', exchangeResp.status, err)
      return NextResponse.redirect(new URL('/login?error=oauth_failed', FRONTEND_URL))
    }

    const { access_token, refresh_token, access_ttl, refresh_ttl } = await exchangeResp.json() as {
      access_token: string
      refresh_token: string
      access_ttl: number
      refresh_ttl: number
    }

    const response = NextResponse.redirect(new URL('/', FRONTEND_URL))

    // Set the same httpOnly cookies the FastAPI /login endpoint would set,
    // but here we set them for this origin (localhost:3400) instead of 8000.
    const secure = process.env.NODE_ENV === 'production'
    response.cookies.set('rcm_access', access_token, {
      httpOnly: true,
      path: '/api',
      sameSite: 'strict',
      secure,
      maxAge: access_ttl,
    })
    response.cookies.set('rcm_refresh', refresh_token, {
      httpOnly: true,
      path: '/api/v1/auth/refresh',
      sameSite: 'strict',
      secure,
      maxAge: refresh_ttl,
    })

    return response
  } catch (e) {
    console.error('[google/callback] unexpected error', e)
    return NextResponse.redirect(new URL('/login?error=oauth_error', FRONTEND_URL))
  }
}
