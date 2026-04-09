'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  Activity,
  FileText,
  AlertCircle,
  TrendingUp,
  Clock,
  Eye,
  BarChart3,
  Search,
  Download,
  RefreshCw
} from 'lucide-react'
import { analyticsDataService, DashboardSummary, UserAnalytics, FeatureUsageStats, ErrorLog, UserSessionDetails } from '@/lib/analytics/analytics-data-service'
import { UserSessionDialog } from '@/components/analytics/UserSessionDialog'

export default function UsageDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [users, setUsers] = useState<UserAnalytics[]>([])
  const [features, setFeatures] = useState<FeatureUsageStats[]>([])
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [fileViews, setFileViews] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedUserDetails, setSelectedUserDetails] = useState<UserSessionDetails | null>(null)
  const [showUserDialog, setShowUserDialog] = useState(false)
  const [loadingUserDetails, setLoadingUserDetails] = useState(false)

  const supabase = createClient()
  const router = useRouter()

  // Check admin status
  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          router.push('/auth')
          return
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()

        if (!profile?.is_admin) {
          router.push('/map-drawing')
          return
        }

        setIsAdmin(true)
        await loadDashboardData()
      } catch (error) {
        console.error('Admin check error:', error)
        router.push('/map-drawing')
      }
    }

    checkAdmin()
  }, [])

  async function loadDashboardData() {
    setLoading(true)
    try {
      const [summaryData, usersData, featuresData, errorsData, fileViewsData] = await Promise.all([
        analyticsDataService.getDashboardSummary(),
        analyticsDataService.getUsersList(100, 0, 'total_sessions'), // Sort by most active
        analyticsDataService.getFeatureUsageStats(30),
        analyticsDataService.getErrorLog(50),
        loadFileViewingData()
      ])

      setSummary(summaryData)
      setUsers(usersData)
      setFeatures(featuresData)
      setErrors(errorsData)
      setFileViews(fileViewsData)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadFileViewingData() {
    try {
      // Query file_viewed and file_view_ended events
      const { data, error } = await supabase
        .from('analytics_events')
        .select('*')
        .in('event_type', ['file_viewed', 'file_view_ended'])
        .order('timestamp', { ascending: false })
        .limit(1000)

      if (error) throw error

      // Group by file name and calculate statistics
      const fileStats: Record<string, any> = {}
      const viewDurations: Record<string, number[]> = {}

      data.forEach(event => {
        const fileName = event.event_data?.file_name
        if (!fileName) return

        if (!fileStats[fileName]) {
          fileStats[fileName] = {
            fileName,
            fileType: event.event_data?.file_type,
            viewCount: 0,
            totalDuration: 0,
            avgDuration: 0,
            users: new Set()
          }
          viewDurations[fileName] = []
        }

        if (event.event_type === 'file_viewed') {
          fileStats[fileName].viewCount++
          fileStats[fileName].users.add(event.user_id)
        } else if (event.event_type === 'file_view_ended') {
          const duration = event.event_data?.view_duration_ms || 0
          viewDurations[fileName].push(duration)
          fileStats[fileName].totalDuration += duration
        }
      })

      // Calculate averages and convert to array
      const result = Object.values(fileStats).map(stat => ({
        ...stat,
        userCount: stat.users.size,
        avgDuration: viewDurations[stat.fileName].length > 0
          ? viewDurations[stat.fileName].reduce((a, b) => a + b, 0) / viewDurations[stat.fileName].length
          : 0,
        users: undefined // Remove Set from final object
      }))

      return result.sort((a, b) => b.viewCount - a.viewCount)
    } catch (error) {
      console.error('Failed to load file viewing data:', error)
      return []
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadDashboardData()
    setRefreshing(false)
  }

  async function handleUserClick(userId: string) {
    setLoadingUserDetails(true)
    setShowUserDialog(true)

    try {
      const details = await analyticsDataService.getUserSessionDetails(userId, 30)
      setSelectedUserDetails(details)
    } catch (error) {
      console.error('Failed to load user session details:', error)
    } finally {
      setLoadingUserDetails(false)
    }
  }

  if (!isAdmin) {
    return null
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-lg">Loading analytics dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-4 md:mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-3xl font-bold mb-1 md:mb-2">Usage Analytics</h1>
            <p className="text-xs md:text-base text-muted-foreground">
              Monitor user activity and application health
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            className="hidden md:flex"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 md:space-y-6">
        <div className="flex items-center gap-2">
        <TabsList className="grid flex-1 grid-cols-5">
          <TabsTrigger value="overview" className="text-xs md:text-sm px-1 md:px-3">
            <BarChart3 className="h-4 w-4 mr-2 hidden md:block" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs md:text-sm px-1 md:px-3">
            <Users className="h-4 w-4 mr-2 hidden md:block" />
            Users
          </TabsTrigger>
          <TabsTrigger value="files" className="text-xs md:text-sm px-1 md:px-3">
            <FileText className="h-4 w-4 mr-2 hidden md:block" />
            Files
          </TabsTrigger>
          <TabsTrigger value="features" className="text-xs md:text-sm px-1 md:px-3">
            <Activity className="h-4 w-4 mr-2 hidden md:block" />
            Features
          </TabsTrigger>
          <TabsTrigger value="errors" className="text-xs md:text-sm px-1 md:px-3">
            <AlertCircle className="h-4 w-4 mr-2 hidden md:block" />
            Errors
          </TabsTrigger>
        </TabsList>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            variant="outline"
            size="icon"
            className="md:hidden h-9 w-9 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary?.totalUsers || 0}</div>
                <p className="text-xs text-muted-foreground">
                  +{summary?.newUsersLast7Days || 0} this week
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Daily Active Users</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary?.dailyActiveUsers || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {summary?.weeklyActiveUsers || 0} weekly / {summary?.monthlyActiveUsers || 0} monthly
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Session</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Math.round((summary?.avgSessionDuration || 0) / 60000)}m
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary?.totalSessions || 0} total sessions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {summary?.errorRate?.toFixed(2) || 0}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary?.totalErrors || 0} errors today
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Features</CardTitle>
                <CardDescription>Most used features in the last 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {features.slice(0, 5).map((feature, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{feature.feature_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {feature.total_users} users
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{feature.total_events}</p>
                        <p className="text-xs text-muted-foreground">events</p>
                      </div>
                    </div>
                  ))}
                  {features.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No feature data yet
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Errors</CardTitle>
                <CardDescription>Last 5 errors encountered</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {errors.slice(0, 5).map((error, idx) => (
                    <div key={idx} className="border-l-2 border-red-500 pl-3">
                      <p className="text-sm font-medium text-red-600">{error.event_type}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {error.error_message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(error.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  {errors.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No errors recorded 🎉
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base md:text-lg">User Analytics</CardTitle>
                  <CardDescription className="text-xs md:text-sm">User activity and engagement metrics</CardDescription>
                </div>
                <div className="hidden md:flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 w-64"
                    />
                  </div>
                </div>
              </div>
              <div className="relative md:hidden">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              {/* Mobile: card layout */}
              <div className="md:hidden space-y-3">
                {filteredUsers.map((user) => (
                  <div
                    key={user.user_id}
                    className="border rounded-lg p-3 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleUserClick(user.user_id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{user.email}</p>
                        {user.display_name && (
                          <p className="text-xs text-muted-foreground">{user.display_name}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {user.is_power_user && (
                          <Badge variant="default" className="text-[10px] px-1.5">Power</Badge>
                        )}
                        {user.is_active ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 text-green-600">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 text-gray-500">Inactive</Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-sm font-semibold">{user.total_pins}</p>
                        <p className="text-[10px] text-muted-foreground">Pins</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{user.total_files_uploaded}</p>
                        <p className="text-[10px] text-muted-foreground">Files</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{user.total_sessions}</p>
                        <p className="text-[10px] text-muted-foreground">Sessions</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">
                          {user.last_activity
                            ? new Date(user.last_activity).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            : '-'}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Last</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table layout */}
              <div className="hidden md:block rounded-md border">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium">Pins</th>
                        <th className="px-4 py-3 text-right text-xs font-medium">Lines</th>
                        <th className="px-4 py-3 text-right text-xs font-medium">Areas</th>
                        <th className="px-4 py-3 text-right text-xs font-medium">Files</th>
                        <th className="px-4 py-3 text-right text-xs font-medium">Sessions</th>
                        <th className="px-4 py-3 text-left text-xs font-medium">Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredUsers.map((user) => (
                        <tr
                          key={user.user_id}
                          className="hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => handleUserClick(user.user_id)}
                        >
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{user.email}</p>
                              {user.display_name && (
                                <p className="text-xs text-muted-foreground">{user.display_name}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {user.is_power_user && (
                                <Badge variant="default" className="text-xs">Power User</Badge>
                              )}
                              {user.is_active ? (
                                <Badge variant="outline" className="text-xs text-green-600">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-gray-500">Inactive</Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{user.total_pins}</td>
                          <td className="px-4 py-3 text-right text-sm">{user.total_lines}</td>
                          <td className="px-4 py-3 text-right text-sm">{user.total_areas}</td>
                          <td className="px-4 py-3 text-right text-sm">{user.total_files_uploaded}</td>
                          <td className="px-4 py-3 text-right text-sm">{user.total_sessions}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {user.last_activity
                              ? new Date(user.last_activity).toLocaleDateString()
                              : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {filteredUsers.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">
                  {searchQuery ? 'No users found matching your search' : 'No users yet'}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Files Tab */}
        <TabsContent value="files" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Files Viewed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fileViews.reduce((sum, f) => sum + f.viewCount, 0)}
                </div>
                <p className="text-xs text-muted-foreground">Total file views</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Unique Files</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fileViews.length}
                </div>
                <p className="text-xs text-muted-foreground">Different files viewed</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Avg View Duration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fileViews.length > 0
                    ? Math.round(fileViews.reduce((sum, f) => sum + f.avgDuration, 0) / fileViews.length / 1000)
                    : 0}s
                </div>
                <p className="text-xs text-muted-foreground">Per file view</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>File Viewing Analytics</CardTitle>
              <CardDescription>Detailed file viewing statistics</CardDescription>
            </CardHeader>
            <CardContent>
              {fileViews.length > 0 ? (
                <div className="space-y-4">
                  {/* Mobile: card layout */}
                  <div className="md:hidden space-y-3">
                    {fileViews.map((file, index) => (
                      <div key={index} className="border rounded-lg p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate min-w-0">{file.fileName}</p>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
                            {file.fileType || '?'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-sm font-semibold">{file.viewCount}</p>
                            <p className="text-[10px] text-muted-foreground">Views</p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{file.userCount}</p>
                            <p className="text-[10px] text-muted-foreground">Users</p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold">
                              {file.avgDuration > 0 ? `${Math.round(file.avgDuration / 1000)}s` : '-'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">Avg</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop: table layout */}
                  <div className="hidden md:block rounded-md border">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-3 text-left text-sm font-medium">File Name</th>
                          <th className="p-3 text-left text-sm font-medium">Type</th>
                          <th className="p-3 text-left text-sm font-medium">Views</th>
                          <th className="p-3 text-left text-sm font-medium">Users</th>
                          <th className="p-3 text-left text-sm font-medium">Avg Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fileViews.map((file, index) => (
                          <tr key={index} className="border-b last:border-0">
                            <td className="p-3">
                              <div className="font-medium text-sm">{file.fileName}</div>
                            </td>
                            <td className="p-3">
                              <Badge variant="secondary" className="text-xs">
                                {file.fileType || 'Unknown'}
                              </Badge>
                            </td>
                            <td className="p-3 text-sm">{file.viewCount}</td>
                            <td className="p-3 text-sm">{file.userCount}</td>
                            <td className="p-3 text-sm">
                              {file.avgDuration > 0
                                ? `${Math.round(file.avgDuration / 1000)}s`
                                : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No file viewing data yet
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Feature Usage Statistics</CardTitle>
              <CardDescription>Track which features are being used and by how many users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {features.map((feature, idx) => (
                  <div key={idx} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{feature.feature_name}</h4>
                      <Badge>{feature.total_users} users</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Total Events</p>
                        <p className="font-bold">{feature.total_events}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Unique Sessions</p>
                        <p className="font-bold">{feature.unique_sessions}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Avg Duration</p>
                        <p className="font-bold">{feature.avg_duration_ms ? `${Math.round(feature.avg_duration_ms / 1000)}s` : 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Error Rate</p>
                        <p className={`font-bold ${feature.error_rate > 5 ? 'text-red-600' : ''}`}>
                          {feature.error_rate.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {features.length === 0 && (
                  <p className="text-center py-8 text-muted-foreground">
                    No feature usage data yet. Data will appear as users interact with the app.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Error Log</CardTitle>
              <CardDescription>Recent errors and issues encountered by users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {errors.map((error) => (
                  <div key={error.id} className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/20 p-4 rounded">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="destructive">{error.event_type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(error.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">
                          {error.error_message}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <p>Page: {error.page_path || 'Unknown'}</p>
                      {error.event_data && Object.keys(error.event_data).length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer hover:underline">View details</summary>
                          <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-x-auto">
                            {JSON.stringify(error.event_data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
                {errors.length === 0 && (
                  <div className="text-center py-8">
                    <AlertCircle className="h-12 w-12 mx-auto mb-3 text-green-500" />
                    <p className="text-lg font-medium">No errors recorded!</p>
                    <p className="text-sm text-muted-foreground">Your app is running smoothly.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* User Session Dialog */}
      <UserSessionDialog
        open={showUserDialog}
        onOpenChange={setShowUserDialog}
        sessionDetails={selectedUserDetails}
      />
    </div>
  )
}
