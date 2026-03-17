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

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password'

interface CustomAuthFormProps {
  initialMode?: AuthMode
}

export default function CustomAuthForm({ initialMode = 'sign-in' }: CustomAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const supabase = createClient()
  const router = useRouter()

  // Normalize email to lowercase for case-insensitive auth
  const normalizedEmail = email.trim().toLowerCase()

  const passwordValidation = mode === 'sign-up' ? validatePassword(password) : null
  const newPasswordValidation = mode === 'reset-password' ? validatePassword(newPassword) : null

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    const startTime = Date.now()
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
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
        email: normalizedEmail,
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
      })

      if (error) throw error

      setSuccess('Password reset link sent! Please check your email (including spam folder).')
      logger.info('Password reset email sent', {
        context: 'CustomAuthForm',
        data: { email: normalizedEmail },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send reset email'
      setError(errorMessage)
      logger.error('Password reset request failed', err, { context: 'CustomAuthForm' })
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    if (!newPasswordValidation?.isValid) {
      setError(newPasswordValidation?.errors[0] || 'Invalid password')
      setLoading(false)
      return
    }

    if (!checkPasswordsMatch(newPassword, confirmNewPassword)) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) throw error

      setSuccess('Password updated successfully! Redirecting to sign in...')
      logger.info('Password reset successful', { context: 'CustomAuthForm' })

      setTimeout(() => {
        setMode('sign-in')
        setNewPassword('')
        setConfirmNewPassword('')
        setSuccess(null)
        router.push('/auth')
      }, 2000)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset password'
      setError(errorMessage)
      logger.error('Password reset failed', err, { context: 'CustomAuthForm' })
    } finally {
      setLoading(false)
    }
  }

  const getFormHandler = () => {
    switch (mode) {
      case 'sign-in': return handleSignIn
      case 'sign-up': return handleSignUp
      case 'forgot-password': return handleForgotPassword
      case 'reset-password': return handleResetPassword
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'sign-in': return 'Sign In'
      case 'sign-up': return 'Sign Up'
      case 'forgot-password': return 'Reset Password'
      case 'reset-password': return 'Set New Password'
    }
  }

  const getDescription = () => {
    switch (mode) {
      case 'sign-in': return 'Sign in to your account to continue'
      case 'sign-up': return 'Create a new account to get started'
      case 'forgot-password': return 'Enter your email and we\'ll send you a reset link'
      case 'reset-password': return 'Choose a new password for your account'
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{getTitle()}</CardTitle>
        <CardDescription>{getDescription()}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={getFormHandler()}>
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

            {/* Email field — shown for sign-in, sign-up, forgot-password */}
            {mode !== 'reset-password' && (
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
            )}

            {/* Password field — shown for sign-in and sign-up */}
            {(mode === 'sign-in' || mode === 'sign-up') && (
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
            )}

            {/* Confirm password — sign-up only */}
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

            {/* New password fields — reset-password only */}
            {mode === 'reset-password' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="••••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  {newPassword && newPasswordValidation && (
                    <div className="mt-2 space-y-1">
                      <p
                        className={`text-sm font-medium ${getPasswordStrengthColor(
                          newPasswordValidation.strength
                        )}`}
                      >
                        Strength: {getPasswordStrengthLabel(newPasswordValidation.strength)}
                      </p>
                      {newPasswordValidation.errors.length > 0 && (
                        <ul className="text-sm text-red-600 space-y-1">
                          {newPasswordValidation.errors.map((err, idx) => (
                            <li key={idx}>• {err}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    placeholder="••••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  {confirmNewPassword && !checkPasswordsMatch(newPassword, confirmNewPassword) && (
                    <p className="text-sm text-red-600">Passwords do not match</p>
                  )}
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? 'Loading...'
                : mode === 'sign-in' ? 'Sign In'
                : mode === 'sign-up' ? 'Sign Up'
                : mode === 'forgot-password' ? 'Send Reset Link'
                : 'Update Password'}
            </Button>

            {/* Forgot password link — sign-in only */}
            {mode === 'sign-in' && (
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => { setMode('forgot-password'); setError(null); setSuccess(null) }}
                >
                  Forgot your password?
                </button>
              </div>
            )}

            <div className="text-center text-sm">
              {mode === 'sign-in' && (
                <p>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => { setMode('sign-up'); setError(null); setSuccess(null) }}
                  >
                    Sign up
                  </button>
                </p>
              )}
              {mode === 'sign-up' && (
                <p>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => { setMode('sign-in'); setError(null); setSuccess(null) }}
                  >
                    Sign in
                  </button>
                </p>
              )}
              {(mode === 'forgot-password' || mode === 'reset-password') && (
                <p>
                  Back to{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => { setMode('sign-in'); setError(null); setSuccess(null) }}
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
