import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from './use-toast'
import { mapDataService } from '@/lib/supabase/map-data-service'
import { Project, Tag, Pin, Line, Area } from '@/lib/supabase/types'
import { createClient } from '@/lib/supabase/client'

export interface UseMapDataProps {
  projectId?: string
  enableSync?: boolean // Whether to sync with database
  isReadOnly?: boolean // Whether the current project is read-only (e.g., shared with partner)
}

export function useMapData({ projectId = 'default', enableSync = true, isReadOnly = false }: UseMapDataProps = {}) {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' && navigator.onLine)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  
  // Data state
  const [projects, setProjects] = useState<Project[]>([
    { id: 'default', name: 'Default Project', createdAt: new Date() }
  ])
  const [tags, setTags] = useState<Tag[]>([
    { id: 'tag1', name: 'Important', color: '#ef4444', projectId: 'default' },
    { id: 'tag2', name: 'Research', color: '#3b82f6', projectId: 'default' },
    { id: 'tag3', name: 'Planning', color: '#10b981', projectId: 'default' }
  ])
  const [pins, setPins] = useState<Pin[]>([])
  const [lines, setLinesInternal] = useState<Line[]>([])
  const [areas, setAreas] = useState<Area[]>([])

  // Track logged duplicate warnings to avoid spam
  const loggedDuplicatesRef = useRef<string>('')

  // Wrapper around setLines to check for issues
  const setLines = useCallback((newLines: Line[] | ((prev: Line[]) => Line[])) => {
    setLinesInternal(prev => {
      const resolvedLines = typeof newLines === 'function' ? newLines(prev) : newLines

      // Only log once per unique set of duplicates (in development)
      if (process.env.NODE_ENV === 'development') {
        const labelCounts: Record<string, number> = {}
        resolvedLines.forEach(line => {
          labelCounts[line.label] = (labelCounts[line.label] || 0) + 1
        })
        const duplicates = Object.entries(labelCounts).filter(([_, count]) => count > 1)
        if (duplicates.length > 0) {
          const duplicateKey = duplicates.map(([label]) => label).sort().join(',')
          if (loggedDuplicatesRef.current !== duplicateKey) {
            console.info('ℹ️ Lines with duplicate labels:', duplicates.map(([label]) => label).join(', '))
            loggedDuplicatesRef.current = duplicateKey
          }
        }
      }

      return resolvedLines
    })
  }, [])

  // Check if user is authenticated
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authCheckComplete, setAuthCheckComplete] = useState(false)

  // Use ref instead of state to prevent re-renders and ensure synchronous check
  const hasInitiallyLoadedRef = useRef(false)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient()
        // Use getSession instead of getUser to avoid auth errors when not logged in
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) {
          console.log('🔒 Auth check: Not authenticated (error)')
          setIsAuthenticated(false)
        } else {
          console.log('🔒 Auth check:', session?.user ? 'Authenticated' : 'Not authenticated')
          setIsAuthenticated(!!session?.user)
        }
      } catch (error) {
        console.error('Error checking authentication:', error)
        setIsAuthenticated(false)
      } finally {
        setAuthCheckComplete(true)
      }
    }
    checkAuth()

    // Fallback timeout to ensure auth check completes even if something goes wrong
    const fallbackTimeout = setTimeout(() => {
      console.log('⚠️  Auth check timeout - marking as complete')
      setAuthCheckComplete(true)
    }, 3000) // 3 second timeout

    // Listen for auth changes
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('🔒 Auth state changed:', event, session?.user ? 'Authenticated' : 'Not authenticated')
      setIsAuthenticated(!!session?.user)
      setAuthCheckComplete(true)
    })

    return () => {
      clearTimeout(fallbackTimeout)
      subscription.unsubscribe()
    }
  }, [])

  // Listen for online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)

      return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      }
    }
  }, [])

  // Load data from localStorage
  const loadFromLocalStorage = useCallback(() => {
    if (typeof window === 'undefined') return

    console.log('📂 Loading data from localStorage...')
    try {
      const storedPins = localStorage.getItem('map-drawing-pins')
      const storedLines = localStorage.getItem('map-drawing-lines')
      const storedAreas = localStorage.getItem('map-drawing-areas')

      if (storedPins) {
        const parsedPins = JSON.parse(storedPins)
        setPins(parsedPins)
        console.log(`✅ Loaded ${parsedPins.length} pins from localStorage`)
      }
      if (storedLines) {
        const parsedLines = JSON.parse(storedLines)
        setLines(parsedLines)
        console.log(`✅ Loaded ${parsedLines.length} lines from localStorage`)
      }
      if (storedAreas) {
        const parsedAreas = JSON.parse(storedAreas)
        setAreas(parsedAreas)
        console.log(`✅ Loaded ${parsedAreas.length} areas from localStorage`)
      }
      console.log('✅ localStorage load complete')
    } catch (error) {
      console.error('❌ Error loading from localStorage:', error)
    }
  }, [])

  // Save to localStorage
  const saveToLocalStorage = useCallback((key: string, data: any) => {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (error) {
      console.error('Error saving to localStorage:', error)
    }
  }, [])

  // Load data from database
  const loadFromDatabase = useCallback(async () => {
    if (!enableSync || !isAuthenticated || !isOnline) {
      console.log('Skipping database load:', { enableSync, isAuthenticated, isOnline })
      return
    }

    setIsLoading(true)
    try {
      // Load each data type separately with individual error handling
      let projectsData = []
      let tagsData = []
      let pinsData = []
      let linesData = []
      let areasData = []

      try {
        projectsData = await mapDataService.getProjects()
      } catch (error) {
        projectsData = []
      }

      try {
        tagsData = await mapDataService.getTags(projectId === 'default' ? undefined : projectId)
      } catch (error) {
        tagsData = []
      }

      try {
        pinsData = await mapDataService.getPins(projectId === 'default' ? undefined : projectId)
      } catch (error) {
        pinsData = []
      }

      try {
        linesData = await mapDataService.getLines(projectId === 'default' ? undefined : projectId)

        // Deduplicate warning already handled in setLines wrapper
        // No need to log here to avoid spam
      } catch (error) {
        console.error('❌ Error loading lines from database:', error)
        linesData = []
      }

      try {
        areasData = await mapDataService.getAreas(projectId === 'default' ? undefined : projectId)
      } catch (error) {
        areasData = []
      }

      // If we have database data, use it; otherwise keep localStorage data
      if (projectsData.length > 0) setProjects(projectsData)
      if (tagsData.length > 0) setTags(tagsData)
      setPins(pinsData)
      setLines(linesData)
      setAreas(areasData)

      // Clear localStorage when we successfully load from database
      // to prevent stale data from overriding database data
      if (typeof window !== 'undefined') {
        localStorage.removeItem('map-drawing-pins')
        localStorage.removeItem('map-drawing-lines')
        localStorage.removeItem('map-drawing-areas')
      }

      setLastSyncTime(new Date())
    } catch (error) {
      console.error('Error loading from database:', error)
      // Don't show error toast if user just isn't authenticated
      if (isAuthenticated) {
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Failed to load data from database. Using local data."
        })
      }
    } finally {
      setIsLoading(false)
    }
  }, [enableSync, isAuthenticated, isOnline, projectId, toast])

  // Initial data load - only run once when auth state is determined
  useEffect(() => {
    // Wait for auth check to complete before loading data
    if (!authCheckComplete) {
      return
    }

    // Skip if already loaded - use ref to ensure synchronous check
    if (hasInitiallyLoadedRef.current) {
      return
    }

    if (enableSync && isAuthenticated) {
      // Mark as loaded immediately to prevent duplicate calls
      hasInitiallyLoadedRef.current = true
      // If authenticated, load from database (don't load from localStorage first)
      loadFromDatabase().catch(err => {
        console.error('Failed to load from database:', err)
        // Ensure loading state is cleared even on error
        setIsLoading(false)
      })
    } else if (!enableSync || isAuthenticated === false) {
      // Mark as loaded immediately
      hasInitiallyLoadedRef.current = true
      // Only load from localStorage if not authenticated or sync is disabled
      loadFromLocalStorage()
      // Immediately set loading to false since localStorage load is synchronous
      setIsLoading(false)
    }
    // Wait for authCheckComplete before loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, enableSync, authCheckComplete])

  // Migrate localStorage data to database
  const migrateToDatabase = useCallback(async () => {
    if (!enableSync || !isAuthenticated || !isOnline) return false

    try {
      const localPins = localStorage.getItem('map-drawing-pins')
      const localLines = localStorage.getItem('map-drawing-lines')
      const localAreas = localStorage.getItem('map-drawing-areas')

      if (localPins || localLines || localAreas) {
        await mapDataService.migrateFromLocalStorage({
          pins: localPins ? JSON.parse(localPins) : [],
          lines: localLines ? JSON.parse(localLines) : [],
          areas: localAreas ? JSON.parse(localAreas) : []
        })

        // Clear localStorage after successful migration
        localStorage.removeItem('map-drawing-pins')
        localStorage.removeItem('map-drawing-lines')
        localStorage.removeItem('map-drawing-areas')

        toast({
          title: "Migration Complete",
          description: "Your local data has been migrated to the database."
        })

        // Reload from database
        await loadFromDatabase()
        return true
      }
    } catch (error) {
      console.error('Migration error:', error)
      toast({
        variant: "destructive",
        title: "Migration Failed",
        description: "Failed to migrate local data to database."
      })
    }
    return false
  }, [enableSync, isAuthenticated, isOnline, toast, loadFromDatabase])

  // Pin operations
  const createPin = useCallback(async (pinData: Omit<Pin, 'id'>) => {
    let newPin: Pin = {
      ...pinData,
      id: crypto.randomUUID()
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        const createdPin = await mapDataService.createPin(pinData)
        console.log('Pin synced successfully, using database ID:', createdPin.id)

        // Use the database-generated pin with its ID
        newPin = createdPin

        // Update local state with database pin (no localStorage for authenticated users)
        const updatedPins = [...pins, newPin]
        setPins(updatedPins)
      } catch (error) {
        console.error('Error syncing pin to database:', {
          error,
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          pinData
        })

        // Fall back to local-only creation with UUID
        const updatedPins = [...pins, newPin]
        setPins(updatedPins)
        saveToLocalStorage('map-drawing-pins', updatedPins)

        toast({
          variant: "destructive",
          title: "Sync Error",
          description: `Pin saved locally but failed to sync to database. ${error instanceof Error ? error.message : 'Unknown error'}`
        })
      }
    } else {
      // Offline or not authenticated - use local UUID
      const updatedPins = [...pins, newPin]
      setPins(updatedPins)
      saveToLocalStorage('map-drawing-pins', updatedPins)
    }

    return newPin
  }, [pins, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const updatePin = useCallback(async (id: string, updates: Partial<Omit<Pin, 'id'>>) => {
    // Update local state
    const updatedPins = pins.map(pin =>
      pin.id === id ? { ...pin, ...updates } : pin
    )
    setPins(updatedPins)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-pins', updatedPins)
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        console.log('useMapData: Attempting to sync pin update to database...', { id, updates })
        const result = await mapDataService.updatePin(id, updates)
        console.log('useMapData: Pin update synced successfully to database', result)
        
        // Only show success message if there was an actual database update
        if (result && result.id) {
          console.log('useMapData: Pin successfully synced with database')
        }
      } catch (error) {
        console.error('useMapData: Error syncing pin update to database:', error)
        
        // Only show error if it's a real error, not a sync warning
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        // Don't show error toast for expected sync issues
        if (!errorMessage.includes('locally created pin') && 
            !errorMessage.includes('couldn\'t be synced') &&
            !errorMessage.includes('fallback')) {
          console.error('useMapData: Showing error toast for:', errorMessage)
          
          toast({
            variant: "destructive",
            title: "Database Sync Error",
            description: `Pin update failed: ${errorMessage}`
          })
        } else {
          console.log('useMapData: Pin updated locally, database sync will be attempted later')
        }
      }
    } else {
      console.log('useMapData: Skipping database sync due to conditions:', { 
        enableSync, 
        isAuthenticated, 
        isOnline 
      })
    }
  }, [pins, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const deletePin = useCallback(async (id: string) => {
    // Update local state
    const updatedPins = pins.filter(pin => pin.id !== id)
    setPins(updatedPins)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-pins', updatedPins)
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.deletePin(id)
      } catch (error) {
        console.error('Error syncing pin deletion to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Pin deleted locally but failed to sync to database."
        })
      }
    }
  }, [pins, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  // Line operations
  const createLine = useCallback(async (lineData: Omit<Line, 'id'>) => {
    let newLine: Line = {
      ...lineData,
      id: crypto.randomUUID()
    }

    if (enableSync && isAuthenticated && isOnline) {
      try {
        console.log('Syncing line to database:', lineData)
        const createdLine = await mapDataService.createLine(lineData)
        console.log('Line synced successfully, using database ID:', createdLine.id)

        // Use the database-generated line with its ID
        newLine = createdLine

        // Update local state (no localStorage for authenticated users)
        const updatedLines = [...lines, newLine]
        setLines(updatedLines)
      } catch (error) {
        console.error('Error syncing line to database:', error)
        // Fall back to local-only creation with UUID
        const updatedLines = [...lines, newLine]
        setLines(updatedLines)
        saveToLocalStorage('map-drawing-lines', updatedLines)

        // Only show toast if user is actually authenticated
        if (isAuthenticated) {
          toast({
            variant: "destructive",
            title: "Sync Error",
            description: "Line saved locally but failed to sync to database."
          })
        }
      }
    } else {
      // Offline or not authenticated - use local UUID
      const updatedLines = [...lines, newLine]
      setLines(updatedLines)
      saveToLocalStorage('map-drawing-lines', updatedLines)
    }

    return newLine
  }, [lines, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const updateLine = useCallback(async (id: string, updates: Partial<Omit<Line, 'id'>>) => {
    const updatedLines = lines.map(line =>
      line.id === id ? { ...line, ...updates } : line
    )
    setLines(updatedLines)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-lines', updatedLines)
    }

    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.updateLine(id, updates)
      } catch (error) {
        console.error('Error syncing line update to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Line updated locally but failed to sync to database."
        })
      }
    }
  }, [lines, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const deleteLine = useCallback(async (id: string) => {
    console.log('🗑️ useMapData.deleteLine - Called for ID:', id)
    console.log('🗑️ useMapData.deleteLine - Conditions:', { enableSync, isAuthenticated, isOnline })

    const updatedLines = lines.filter(line => line.id !== id)
    console.log('🗑️ useMapData.deleteLine - Lines before:', lines.length, 'after:', updatedLines.length)
    setLines(updatedLines)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      console.log('💾 useMapData.deleteLine - Saving to localStorage (not authenticated)')
      saveToLocalStorage('map-drawing-lines', updatedLines)
    }

    if (enableSync && isAuthenticated && isOnline) {
      console.log('🌐 useMapData.deleteLine - Syncing to database...')
      try {
        await mapDataService.deleteLine(id)
        console.log('✅ useMapData.deleteLine - Database sync successful')
      } catch (error) {
        console.error('❌ useMapData.deleteLine - Database sync failed:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Line deleted locally but failed to sync to database."
        })
      }
    } else {
      console.log('⏭️ useMapData.deleteLine - Skipping database sync')
    }
  }, [lines, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  // Area operations
  const createArea = useCallback(async (areaData: Omit<Area, 'id'>) => {
    let newArea: Area = {
      ...areaData,
      id: crypto.randomUUID()
    }

    if (enableSync && isAuthenticated && isOnline) {
      try {
        const createdArea = await mapDataService.createArea(areaData)
        console.log('Area synced successfully, using database ID:', createdArea.id)

        // Use the database-generated area with its ID
        newArea = createdArea

        // Update local state (no localStorage for authenticated users)
        const updatedAreas = [...areas, newArea]
        setAreas(updatedAreas)
      } catch (error) {
        console.error('Error syncing area to database:', error)

        // Fall back to local-only creation with UUID
        const updatedAreas = [...areas, newArea]
        setAreas(updatedAreas)
        saveToLocalStorage('map-drawing-areas', updatedAreas)

        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Area saved locally but failed to sync to database."
        })
      }
    } else {
      // Offline or not authenticated - use local UUID
      const updatedAreas = [...areas, newArea]
      setAreas(updatedAreas)
      saveToLocalStorage('map-drawing-areas', updatedAreas)
    }

    return newArea
  }, [areas, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const updateArea = useCallback(async (id: string, updates: Partial<Omit<Area, 'id'>>) => {
    const updatedAreas = areas.map(area =>
      area.id === id ? { ...area, ...updates } : area
    )
    setAreas(updatedAreas)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-areas', updatedAreas)
    }

    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.updateArea(id, updates)
      } catch (error) {
        console.error('Error syncing area update to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Area updated locally but failed to sync to database."
        })
      }
    }
  }, [areas, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const deleteArea = useCallback(async (id: string) => {
    console.log('🗑️ useMapData.deleteArea - Called for ID:', id)
    console.log('🗑️ useMapData.deleteArea - Conditions:', { enableSync, isAuthenticated, isOnline })

    const updatedAreas = areas.filter(area => area.id !== id)
    console.log('🗑️ useMapData.deleteArea - Areas before:', areas.length, 'after:', updatedAreas.length)
    setAreas(updatedAreas)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      console.log('💾 useMapData.deleteArea - Saving to localStorage (not authenticated)')
      saveToLocalStorage('map-drawing-areas', updatedAreas)
    }

    if (enableSync && isAuthenticated && isOnline) {
      console.log('🌐 useMapData.deleteArea - Syncing to database...')
      try {
        await mapDataService.deleteArea(id)
        console.log('✅ useMapData.deleteArea - Database sync successful')
      } catch (error) {
        console.error('❌ useMapData.deleteArea - Database sync failed:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Area deleted locally but failed to sync to database."
        })
      }
    } else {
      console.log('⏭️ useMapData.deleteArea - Skipping database sync')
    }
  }, [areas, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  // Batch operations
  const batchUpdatePins = useCallback(async (pinIds: string[], updates: Partial<Omit<Pin, 'id'>>) => {
    // Update local state
    const updatedPins = pins.map(pin =>
      pinIds.includes(pin.id) ? { ...pin, ...updates } : pin
    )
    setPins(updatedPins)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-pins', updatedPins)
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.batchUpdatePins(pinIds, updates)
      } catch (error) {
        console.error('Error syncing batch pin updates to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Pins updated locally but failed to sync to database."
        })
      }
    }
  }, [pins, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const batchUpdateLines = useCallback(async (lineIds: string[], updates: Partial<Omit<Line, 'id'>>) => {
    // Update local state
    const updatedLines = lines.map(line =>
      lineIds.includes(line.id) ? { ...line, ...updates } : line
    )
    setLines(updatedLines)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-lines', updatedLines)
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.batchUpdateLines(lineIds, updates)
      } catch (error) {
        console.error('Error syncing batch line updates to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Lines updated locally but failed to sync to database."
        })
      }
    }
  }, [lines, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  const batchUpdateAreas = useCallback(async (areaIds: string[], updates: Partial<Omit<Area, 'id'>>) => {
    // Update local state
    const updatedAreas = areas.map(area =>
      areaIds.includes(area.id) ? { ...area, ...updates } : area
    )
    setAreas(updatedAreas)

    // Only save to localStorage if not authenticated
    if (!isAuthenticated || !enableSync) {
      saveToLocalStorage('map-drawing-areas', updatedAreas)
    }

    // Sync to database if online and authenticated
    if (enableSync && isAuthenticated && isOnline) {
      try {
        await mapDataService.batchUpdateAreas(areaIds, updates)
      } catch (error) {
        console.error('Error syncing batch area updates to database:', error)
        toast({
          variant: "destructive",
          title: "Sync Error",
          description: "Areas updated locally but failed to sync to database."
        })
      }
    }
  }, [areas, enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  // Clear all data
  const clearAll = useCallback(async () => {
    setPins([])
    setLines([])
    setAreas([])
    
    saveToLocalStorage('map-drawing-pins', [])
    saveToLocalStorage('map-drawing-lines', [])
    saveToLocalStorage('map-drawing-areas', [])

    if (enableSync && isAuthenticated && isOnline) {
      try {
        // Note: This would need to be implemented in the service
        // For now, we'll just clear local data
        toast({
          title: "Data Cleared",
          description: "All local data has been cleared. Database data remains."
        })
      } catch (error) {
        console.error('Error clearing database:', error)
      }
    } else {
      toast({
        title: "Data Cleared",
        description: "All local data has been cleared."
      })
    }
  }, [enableSync, isAuthenticated, isOnline, saveToLocalStorage, toast])

  // Force sync
  const forceSync = useCallback(async () => {
    if (enableSync && isAuthenticated && isOnline) {
      await loadFromDatabase()
    }
  }, [enableSync, isAuthenticated, isOnline, loadFromDatabase])

  return {
    // Data
    projects,
    tags,
    pins,
    lines,
    areas,

    // State
    isLoading,
    isOnline,
    isAuthenticated,
    isReadOnly,
    lastSyncTime,

    // Pin operations
    createPin,
    updatePin,
    deletePin,

    // Line operations
    createLine,
    updateLine,
    deleteLine,

    // Area operations
    createArea,
    updateArea,
    deleteArea,

    // Batch operations
    batchUpdatePins,
    batchUpdateLines,
    batchUpdateAreas,

    // Utility operations
    clearAll,
    forceSync,
    migrateToDatabase,
    loadFromDatabase
  }
}