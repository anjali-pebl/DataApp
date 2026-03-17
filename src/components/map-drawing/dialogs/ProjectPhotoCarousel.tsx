'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, X, Download, MapPin, Square } from 'lucide-react'
import { projectService } from '@/lib/supabase/project-service'

interface ProjectPhoto {
  url: string
  fileName: string
  pinName?: string
  areaName?: string
}

interface ProjectPhotoCarouselProps {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
}

export default function ProjectPhotoCarousel({
  open,
  onClose,
  projectId,
  projectName,
}: ProjectPhotoCarouselProps) {
  const [photos, setPhotos] = useState<ProjectPhoto[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setCurrentIndex(0)
    projectService.getProjectPhotos(projectId).then(result => {
      setPhotos(result)
      setLoading(false)
    })
  }, [open, projectId])

  const goNext = useCallback(() => {
    setCurrentIndex(i => (i + 1) % photos.length)
  }, [photos.length])

  const goPrev = useCallback(() => {
    setCurrentIndex(i => (i - 1 + photos.length) % photos.length)
  }, [photos.length])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, goNext, goPrev, onClose])

  const currentPhoto = photos[currentIndex]

  const handleDownload = async () => {
    if (!currentPhoto) return
    const link = document.createElement('a')
    link.href = currentPhoto.url
    link.download = currentPhoto.fileName
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 bg-black/95 border-none [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80">
          <div className="text-white">
            <h3 className="text-sm font-medium">{projectName} Photos</h3>
            {photos.length > 0 && (
              <p className="text-xs text-white/60">
                {currentIndex + 1} of {photos.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentPhoto && (
              <Button
                variant="ghost"
                size="icon"
                className="text-white/70 hover:text-white hover:bg-white/10 h-8 w-8"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10 h-8 w-8"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="relative flex items-center justify-center min-h-[60vh] max-h-[75vh]">
          {loading ? (
            <div className="text-white/60 text-sm">Loading photos...</div>
          ) : photos.length === 0 ? (
            <div className="text-white/60 text-sm text-center p-8">
              <p>No photos uploaded to this project yet.</p>
              <p className="text-xs mt-2">Upload photos to pins or areas to see them here.</p>
            </div>
          ) : currentPhoto ? (
            <>
              {/* Previous button */}
              {photos.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 z-10 text-white/70 hover:text-white hover:bg-white/10 h-10 w-10 rounded-full"
                  onClick={goPrev}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
              )}

              {/* Image */}
              <img
                src={currentPhoto.url}
                alt={currentPhoto.fileName}
                className="max-h-[70vh] max-w-full object-contain select-none"
                draggable={false}
              />

              {/* Next button */}
              {photos.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 z-10 text-white/70 hover:text-white hover:bg-white/10 h-10 w-10 rounded-full"
                  onClick={goNext}
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              )}
            </>
          ) : null}
        </div>

        {/* Footer - photo info and thumbnail strip */}
        {currentPhoto && (
          <div className="px-4 pb-3">
            {/* Photo source info */}
            <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
              {currentPhoto.pinName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {currentPhoto.pinName}
                </span>
              )}
              {currentPhoto.areaName && (
                <span className="flex items-center gap-1">
                  <Square className="h-3 w-3" />
                  {currentPhoto.areaName}
                </span>
              )}
              <span className="ml-auto">{currentPhoto.fileName}</span>
            </div>

            {/* Thumbnail strip */}
            {photos.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {photos.map((photo, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-all ${
                      idx === currentIndex
                        ? 'border-accent opacity-100'
                        : 'border-transparent opacity-50 hover:opacity-80'
                    }`}
                  >
                    <img
                      src={photo.url}
                      alt={photo.fileName}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
