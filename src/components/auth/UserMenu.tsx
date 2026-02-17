'use client';

import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SunMoon, Settings, LogOut, Ruler, Map, BarChart3, Loader2, Save, Lock, Check, X, FolderOpen, LineChart, Video } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/hooks/use-settings'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { dataSyncService } from '@/lib/supabase/data-sync-service'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSyncNotifications } from '@/components/ui/sync-notifications'
import { SyncNotificationsContainer } from '@/components/ui/sync-notifications-container'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoadPlotViewDialog } from '@/components/pin-data/LoadPlotViewDialog'
import type { SavedPlotView, PlotViewValidationResult } from '@/lib/supabase/plot-view-types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { Database } from 'lucide-react'
import { analyticsService } from '@/lib/analytics/analytics-service'

interface UserMenuProps {
  user: User
  projectId?: string // Optional project ID for Load Saved Plots feature
}

export default function UserMenu({ user, projectId }: UserMenuProps) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const { settings, setSettings } = useSettings()
  const { notifications, showNotification, updateNotification, removeNotification } = useSyncNotifications()
  
  // Admin check state
  const [isAdmin, setIsAdmin] = useState(false)

  // Account Settings state
  const [showAccountSettings, setShowAccountSettings] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Load Plot View Dialog state
  const [showLoadPlotViewDialog, setShowLoadPlotViewDialog] = useState(false)

  // Theme management
  useEffect(() => {
    const storedTheme = typeof window !== 'undefined' ? localStorage.getItem("theme") : null
    if (storedTheme) {
      setTheme(storedTheme as 'light' | 'dark')
    } else {
      // Default to light mode if no preference is stored
      setTheme("light")
      if (typeof window !== 'undefined') {
        localStorage.setItem("theme", "light")
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (theme === "dark") document.documentElement.classList.add("dark")
      else document.documentElement.classList.remove("dark")
      localStorage.setItem("theme", theme)
    }
  }, [theme])

  // Check if user is admin (pebl role or is_admin flag)
  useEffect(() => {
    async function checkAdminStatus() {
      // Query is_admin first (always exists), account_role may not exist yet before migration
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (profile?.is_admin) {
        setIsAdmin(true)
        return
      }

      // Try account_role (exists after RBAC migration)
      const { data: roleProfile } = await supabase
        .from('user_profiles')
        .select('account_role')
        .eq('id', user.id)
        .single()

      if (roleProfile?.account_role === 'pebl') {
        setIsAdmin(true)
      }
    }

    checkAdminStatus()
  }, [user.id, supabase])

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === "light" ? "dark" : "light"))
  }

  const toggleUnits = () => {
    if (settings) {
      setSettings({
        ...settings,
        units: settings.units === 'metric' ? 'imperial' : 'metric'
      })
    }
  }

  const handlePasswordChange = async () => {
    // Reset error and success states
    setPasswordError('')
    setPasswordSuccess(false)
    
    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required')
      return
    }
    
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters')
      return
    }
    
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    
    setIsChangingPassword(true)
    
    try {
      // First verify current password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: currentPassword
      })
      
      if (signInError) {
        setPasswordError('Current password is incorrect')
        setIsChangingPassword(false)
        return
      }
      
      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })
      
      if (updateError) {
        setPasswordError(updateError.message)
        setIsChangingPassword(false)
        return
      }
      
      // Success
      setPasswordSuccess(true)
      toast({
        title: "Password Changed",
        description: "Your password has been successfully updated."
      })
      
      // Clear form and close dialog after delay
      setTimeout(() => {
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setPasswordError('')
        setPasswordSuccess(false)
        setShowAccountSettings(false)
      }, 2000)
      
    } catch (error) {
      console.error('Error changing password:', error)
      setPasswordError('An unexpected error occurred')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleLoadPlotView = (view: SavedPlotView, validation: PlotViewValidationResult) => {
    console.log('📂 Plot view loaded from UserMenu:', view.name, validation);

    // Since this is from the global menu, we just show a success message
    // The actual loading logic will be handled by the map-drawing page
    // which should listen for plot view events or handle this through state management

    toast({
      title: "Plot View Selected",
      description: `"${view.name}" loaded. Navigate to the pin to view the plots.`
    });

    // TODO: Implement actual plot view restoration
    // This could involve:
    // 1. Storing the selected view in localStorage or global state
    // 2. Emitting an event that the map-drawing page listens to
    // 3. Passing the view data through URL params
    // For now, we just close the dialog as the feature is accessible from the plot component itself
  };

  const handleSignOut = async () => {
    // Track logout event
    await analyticsService.trackLogout()

    // Show backup notification
    const backupNotificationId = showNotification({
      type: 'backup',
      status: 'loading',
      title: 'Backing Up Data',
      message: 'Saving your pins, lines, and areas to the cloud...'
    })

    try {
      // Step 1: Backup all data
      console.log('Starting data backup before logout...')
      const backupResult = await dataSyncService.backupUserData()
      
      if (!backupResult.success) {
        // Update to error state
        updateNotification(backupNotificationId, {
          status: 'error',
          title: 'Backup Warning',
          message: backupResult.message
        })
      } else {
        // Update to success state
        updateNotification(backupNotificationId, {
          status: 'success',
          title: 'Data Backed Up',
          message: 'All your data has been saved successfully',
          details: backupResult.details
        })
      }

      // Step 2: Show logout notification
      const logoutNotificationId = showNotification({
        type: 'logout',
        status: 'loading',
        title: 'Signing Out',
        message: 'Clearing session and local data...'
      })

      await supabase.auth.signOut()
      
      // Step 3: Clear local data after successful backup
      if (typeof window !== 'undefined') {
        localStorage.removeItem('map-drawing-pins')
        localStorage.removeItem('map-drawing-lines')
        localStorage.removeItem('map-drawing-areas')
        localStorage.removeItem('map-drawing-projects')
        localStorage.removeItem('map-drawing-tags')
      }

      // Update logout notification to success
      updateNotification(logoutNotificationId, {
        status: 'success',
        title: 'Signed Out',
        message: 'You have been successfully signed out'
      })

      // Step 4: Redirect after brief delay
      setTimeout(() => {
        router.push('/auth')
        router.refresh()
      }, 1500)
      
    } catch (error) {
      console.error('Error during sign out:', error)
      toast({
        variant: "destructive",
        title: "Sign Out Error",
        description: "There was an error signing out. Please try again.",
      })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-9 w-9 rounded-full">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user.user_metadata.avatar_url} alt={user.email} />
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user.email?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 z-[10000] user-dropdown-menu" align="end" forceMount>
        {/* User Info */}
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.email}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.user_metadata.full_name || 'User'}
            </p>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        {/* Theme Toggle */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center space-x-2">
            <SunMoon className="h-4 w-4" />
            <Label htmlFor="theme-toggle" className="text-sm">Dark Mode</Label>
          </div>
          <Switch
            id="theme-toggle"
            checked={theme === 'dark'}
            onCheckedChange={toggleTheme}
          />
        </div>
        
        {/* Units Toggle */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center space-x-2">
            <Ruler className="h-4 w-4" />
            <Label htmlFor="units-toggle" className="text-sm">Imperial Units</Label>
          </div>
          <Switch
            id="units-toggle"
            checked={settings?.units === 'imperial'}
            onCheckedChange={toggleUnits}
            disabled={!settings}
          />
        </div>
        
        <DropdownMenuSeparator />

        {/* Navigation Items */}
        {/* Data Processing - Integrated Ocean-ML */}
        <Link href="/data-processing">
          <DropdownMenuItem className="cursor-pointer">
            <Database className="mr-2 h-4 w-4" />
            <span>Data Processing</span>
            {pathname === '/data-processing' && <div className="ml-auto w-2 h-2 bg-primary rounded-full" />}
          </DropdownMenuItem>
        </Link>

        <Link href="/motion-analysis">
          <DropdownMenuItem className="cursor-pointer">
            <Video className="mr-2 h-4 w-4" />
            <span>Motion Analysis</span>
            {pathname === '/motion-analysis' && <div className="ml-auto w-2 h-2 bg-primary rounded-full" />}
          </DropdownMenuItem>
        </Link>

        <Link href="/map-drawing">
          <DropdownMenuItem className="cursor-pointer">
            <Map className="mr-2 h-4 w-4" />
            <span>Map Drawing</span>
            {pathname === '/map-drawing' && <div className="ml-auto w-2 h-2 bg-primary rounded-full" />}
          </DropdownMenuItem>
        </Link>

        {/* Load Saved Plots - only show when on map-drawing page with project */}
        {pathname === '/map-drawing' && projectId && (
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setShowLoadPlotViewDialog(true)}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            <span>Load Saved Plots</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Account Settings */}
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => setShowAccountSettings(true)}
        >
          <Settings className="mr-2 h-4 w-4" />
          <span>Account Settings</span>
        </DropdownMenuItem>

        {/* Admin Tools - Admin Only */}
        {isAdmin && (
          <>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => router.push('/admin/partners')}
            >
              <Shield className="mr-2 h-4 w-4" />
              <span>Partner Management</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => router.push('/usage-dashboard')}
            >
              <LineChart className="mr-2 h-4 w-4" />
              <span>Analytics Dashboard</span>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        {/* Sign Out */}
        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    {/* Sync Notifications */}
    <SyncNotificationsContainer 
      notifications={notifications}
      onRemove={removeNotification}
    />

    {/* Account Settings Dialog */}
    <Dialog open={showAccountSettings} onOpenChange={setShowAccountSettings}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account Settings</DialogTitle>
          <DialogDescription>
            Manage your account preferences and security settings
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* User Information */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Account Information</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email:</span>
                <span>{user.email}</span>
              </div>
              {user.user_metadata.full_name && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name:</span>
                  <span>{user.user_metadata.full_name}</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium mb-4">Change Password</h3>
            
            {passwordSuccess ? (
              <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-600 dark:text-green-400">
                  Password changed successfully!
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="current-password"
                      type="password"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="pl-10"
                      disabled={isChangingPassword}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Enter new password (min 6 characters)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pl-10"
                      disabled={isChangingPassword}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                      disabled={isChangingPassword}
                    />
                  </div>
                </div>
                
                {passwordError && (
                  <Alert variant="destructive">
                    <X className="h-4 w-4" />
                    <AlertDescription>
                      {passwordError}
                    </AlertDescription>
                  </Alert>
                )}
                
                <div className="flex justify-end space-x-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAccountSettings(false)
                      setCurrentPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                      setPasswordError('')
                      setPasswordSuccess(false)
                    }}
                    disabled={isChangingPassword}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handlePasswordChange}
                    disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
                  >
                    {isChangingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Changing...
                      </>
                    ) : (
                      'Change Password'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Load Plot View Dialog */}
    {projectId && (
      <LoadPlotViewDialog
        open={showLoadPlotViewDialog}
        onOpenChange={setShowLoadPlotViewDialog}
        projectId={projectId}
        onLoad={handleLoadPlotView}
      />
    )}
    </>
  )
}