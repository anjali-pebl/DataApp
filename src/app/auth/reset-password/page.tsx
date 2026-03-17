'use client'

import CustomAuthForm from '@/components/auth/CustomAuthForm'

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Reset Your Password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Choose a new password for your account
          </p>
        </div>
        <div className="max-w-md mx-auto mt-8 p-6">
          <CustomAuthForm initialMode="reset-password" />
        </div>
      </div>
    </div>
  )
}
