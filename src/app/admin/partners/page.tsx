'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { adminService } from '@/lib/supabase/admin-service'
import type { ProjectSummary } from '@/lib/supabase/admin-service'
import type { UserProfile } from '@/lib/supabase/role-service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  Check,
  X,
  Search,
  FolderOpen,
  Users,
  Clock,
  Shield,
  Loader2,
} from 'lucide-react'

export default function PartnersPage() {
  const { toast } = useToast()
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([])
  const [partners, setPartners] = useState<UserProfile[]>([])
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Project sharing dialog state
  const [sharingDialogOpen, setSharingDialogOpen] = useState(false)
  const [selectedPartner, setSelectedPartner] = useState<UserProfile | null>(null)
  const [partnerSharedProjectIds, setPartnerSharedProjectIds] = useState<Set<string>>(new Set())
  const [savingShares, setSavingShares] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [pending, partnersList, projects] = await Promise.all([
        adminService.getPendingUsers(),
        adminService.getPartners(),
        adminService.getAllProjects(),
      ])
      setPendingUsers(pending)
      setPartners(partnersList)
      setAllProjects(projects)
    } catch (err) {
      console.error('Failed to load admin data:', err)
      toast({
        variant: 'destructive',
        title: 'Load Error',
        description: 'Failed to load partner data.',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleApprove = async (userId: string) => {
    try {
      await adminService.approveUser(userId)
      toast({ title: 'User Approved', description: 'User has been granted partner access.' })
      await loadData()
    } catch (err) {
      console.error('Failed to approve user:', err)
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to approve user.' })
    }
  }

  const handleReject = async (userId: string) => {
    try {
      await adminService.rejectUser(userId)
      toast({ title: 'User Rejected', description: 'User has been removed.' })
      await loadData()
    } catch (err) {
      console.error('Failed to reject user:', err)
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to reject user.' })
    }
  }

  const openSharingDialog = async (partner: UserProfile) => {
    setSelectedPartner(partner)
    try {
      const shares = await adminService.getProjectShares(partner.id)
      setPartnerSharedProjectIds(new Set(shares.map(s => s.project_id)))
    } catch {
      setPartnerSharedProjectIds(new Set())
    }
    setSharingDialogOpen(true)
  }

  const toggleProjectShare = async (projectId: string, isCurrentlyShared: boolean) => {
    if (!selectedPartner) return
    setSavingShares(true)
    try {
      if (isCurrentlyShared) {
        await adminService.revokeProjectShare(projectId, selectedPartner.id)
        setPartnerSharedProjectIds(prev => {
          const next = new Set(prev)
          next.delete(projectId)
          return next
        })
      } else {
        await adminService.shareProject(projectId, selectedPartner.id)
        setPartnerSharedProjectIds(prev => new Set(prev).add(projectId))
      }
    } catch (err) {
      console.error('Failed to update project share:', err)
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update sharing.' })
    } finally {
      setSavingShares(false)
    }
  }

  const filteredPartners = partners.filter(p =>
    !searchQuery ||
    p.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2 md:gap-3">
          <Link href="/map-drawing">
            <Button variant="ghost" size="sm" className="h-8 w-8 md:h-9 md:w-auto p-0 md:px-3">
              <ArrowLeft className="h-4 w-4 md:mr-1" />
              <span className="hidden md:inline">Back</span>
            </Button>
          </Link>
          <div>
            <h1 className="text-base md:text-2xl font-bold flex items-center gap-1.5 md:gap-2">
              <Shield className="h-4 w-4 md:h-6 md:w-6" />
              Partner Management
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              Manage accounts and project access
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <Card>
            <CardHeader className="pb-2 p-3 md:p-6 items-center md:items-start">
              <CardDescription className="text-xs md:text-sm">Pending</CardDescription>
              <CardTitle className="text-xl md:text-3xl flex items-center gap-1 md:gap-2">
                <Clock className="h-4 w-4 md:h-6 md:w-6 text-amber-500" />
                {pendingUsers.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2 p-3 md:p-6 items-center md:items-start">
              <CardDescription className="text-xs md:text-sm">Partners</CardDescription>
              <CardTitle className="text-xl md:text-3xl flex items-center gap-1 md:gap-2">
                <Users className="h-4 w-4 md:h-6 md:w-6 text-blue-500" />
                {partners.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2 p-3 md:p-6 items-center md:items-start">
              <CardDescription className="text-xs md:text-sm">Projects</CardDescription>
              <CardTitle className="text-xl md:text-3xl flex items-center gap-1 md:gap-2">
                <FolderOpen className="h-4 w-4 md:h-6 md:w-6 text-green-500" />
                {allProjects.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue={pendingUsers.length > 0 ? 'pending' : 'partners'}>
          <TabsList>
            <TabsTrigger value="pending" className="gap-1">
              Pending
              {pendingUsers.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] text-xs">
                  {pendingUsers.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="partners">Active Partners</TabsTrigger>
          </TabsList>

          {/* Pending Tab */}
          <TabsContent value="pending" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approvals</CardTitle>
                <CardDescription>
                  Users who have signed up and are waiting for admin approval.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No pending approvals.
                  </p>
                ) : (
                  <>
                  {/* Mobile: card layout */}
                  <div className="md:hidden space-y-3">
                    {pendingUsers.map(user => (
                      <div key={user.id} className="border rounded-lg p-3 space-y-2">
                        <div>
                          <p className="text-sm font-medium truncate">{user.email}</p>
                          <p className="text-xs text-muted-foreground">{user.display_name || '-'} · Signed up {formatDate(user.created_at)}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="default" className="flex-1 h-8 text-xs" onClick={() => handleApprove(user.id)}>
                            <Check className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="flex-1 h-8 text-xs" onClick={() => handleReject(user.id)}>
                            <X className="h-3 w-3 mr-1" /> Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop: table layout */}
                  <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Signed Up</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingUsers.map(user => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">{user.email}</TableCell>
                          <TableCell>{user.display_name || '-'}</TableCell>
                          <TableCell>{formatDate(user.created_at)}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(user.id)}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(user.id)}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Partners Tab */}
          <TabsContent value="partners" className="space-y-4">
            <Card>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base md:text-lg">Active Partners</CardTitle>
                    <CardDescription className="text-xs md:text-sm">
                      Approved partner accounts with project access.
                    </CardDescription>
                  </div>
                  <div className="relative w-64 hidden md:block">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search partners..."
                      className="pl-8 h-9"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="relative md:hidden">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search partners..."
                    className="pl-8 h-9"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {filteredPartners.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {searchQuery ? 'No partners match your search.' : 'No active partners yet.'}
                  </p>
                ) : (
                  <>
                  {/* Mobile: card layout */}
                  <div className="md:hidden space-y-3">
                    {filteredPartners.map(partner => (
                      <div key={partner.id} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{partner.email}</p>
                            <p className="text-xs text-muted-foreground">{partner.display_name || '-'} · Joined {formatDate(partner.created_at)}</p>
                          </div>
                          <Badge variant="secondary" className="shrink-0 text-xs">Partner</Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-8 text-xs"
                          onClick={() => openSharingDialog(partner)}
                        >
                          <FolderOpen className="h-3 w-3 mr-1" />
                          Manage Projects
                        </Button>
                      </div>
                    ))}
                  </div>
                  {/* Desktop: table layout */}
                  <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPartners.map(partner => (
                        <TableRow key={partner.id}>
                          <TableCell className="font-medium">{partner.email}</TableCell>
                          <TableCell>{partner.display_name || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">Partner</Badge>
                          </TableCell>
                          <TableCell>{formatDate(partner.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSharingDialog(partner)}
                            >
                              <FolderOpen className="h-4 w-4 mr-1" />
                              Manage Projects
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Project Sharing Dialog */}
      <Dialog open={sharingDialogOpen} onOpenChange={setSharingDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[80vh] overflow-y-auto p-4 md:p-6">
          <DialogHeader>
            <DialogTitle>Manage Project Access</DialogTitle>
            <DialogDescription>
              Select which projects{' '}
              <span className="font-medium">{selectedPartner?.email}</span>{' '}
              can access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {allProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No projects available.
              </p>
            ) : (
              allProjects.map(project => {
                const isShared = partnerSharedProjectIds.has(project.id)
                return (
                  <div
                    key={project.id}
                    className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isShared}
                        disabled={savingShares}
                        onCheckedChange={() => toggleProjectShare(project.id, isShared)}
                      />
                      <div>
                        <p className="text-sm font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDate(project.created_at)}
                        </p>
                      </div>
                    </div>
                    {isShared && (
                      <Badge variant="outline" className="text-xs">
                        Shared
                      </Badge>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
