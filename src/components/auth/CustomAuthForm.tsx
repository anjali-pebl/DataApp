'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  validatePassword,
  checkPasswordsMatch,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
} from '@/lib/password-validation'
import { logger } from '@/lib/logger'
import { analyticsService } from '@/lib/analytics/analytics-service'

type AuthMode = 'sign-in' | 'sign-up'

export default function CustomAuthForm() {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const supabase = createClient()
  const router = useRouter()

  const passwordValidation = mode === 'sign-up' ? validatePassword(password) : null

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    const startTime = Date.now()
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      logger.info('User signed in successfully', {
        context: 'CustomAuthForm',
        data: { email },
      })

      // Track successful login
      analyticsService.trackSessionStart('email_password').catch(err => console.error('Analytics tracking error:', err))

      router.push('/map-drawing')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in'
      setError(errorMessage)
      logger.error('Sign in failed', err, { context: 'CustomAuthForm' })
      // Track login error
      analyticsService.trackError('login', err as Error, { email }).catch(err => console.error('Analytics tracking error:', err))
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    const startTime = Date.now()
    setLoading(true)
    setError(null)
    setSuccess(null)

    // Validate password
    if (!passwordValidation?.isValid) {
      setError(passwordValidation?.errors[0] || 'Invalid password')
      setLoading(false)
      // Track validation error
      analyticsService.trackError('signup', 'Password validation failed', { email }).catch(err => console.error('Analytics tracking error:', err))
      return
    }

    // Check passwords match
    if (!checkPasswordsMatch(password, confirmPassword)) {
      setError('Passwords do not match')
      setLoading(false)
      // Track validation error
      analyticsService.trackError('signup', 'Passwords do not match', { email }).catch(err => console.error('Analytics tracking error:', err))
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) throw error

      logger.info('User signed up successfully', {
        context: 'CustomAuthForm',
        data: { email },
      })

      // Track successful signup
      analyticsService.trackAction('signup', 'authentication', { email }, startTime).catch(err => console.error('Analytics tracking error:', err))

      const isPeblEmail = email.toLowerCase().endsWith('@pebl-cic.co.uk')
      setSuccess(
        isPeblEmail
          ? 'Account created! Please check your email to confirm your account.'
          : 'Account created! Please check your email to confirm your account. A PEBL administrator will review your access request.'
      )
      setEmail('')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign up'
      setError(errorMessage)
      logger.error('Sign up failed', err, { context: 'CustomAuthForm' })
      // Track signup error
      analyticsService.trackError('signup', err as Error, { email }).catch(err => console.error('Analytics tracking error:', err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{mode === 'sign-in' ? 'Sign In' : 'Sign Up'}</CardTitle>
        <CardDescription>
          {mode === 'sign-in'
            ? 'Sign in to your account to continue'
            : 'Create a new account to get started'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={mode === 'sign-in' ? handleSignIn : handleSignUp}>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              {mode === 'sign-up' && password && passwordValidation && (
                <div className="mt-2 space-y-1">
                  <p
                    className={`text-sm font-medium ${getPasswordStrengthColor(
                      passwordValidation.strength
                    )}`}
                  >
                    Strength: {getPasswordStrengthLabel(passwordValidation.strength)}
                  </p>
                  {passwordValidation.errors.length > 0 && (
                    <ul className="text-sm text-red-600 space-y-1">
                      {passwordValidation.errors.map((err, idx) => (
                        <li key={idx}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {mode === 'sign-up' && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                {confirmPassword && !checkPasswordsMatch(password, confirmPassword) && (
                  <p className="text-sm text-red-600">Passwords do not match</p>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Loading...' : mode === 'sign-in' ? 'Sign In' : 'Sign Up'}
            </Button>

            <div className="text-center text-sm">
              {mode === 'sign-in' ? (
                <p>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setMode('sign-up')}
                  >
                    Sign up
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setMode('sign-in')}
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
