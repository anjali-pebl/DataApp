import { useState, useEffect } from 'react';

export interface MapView {
  center: { lat: number; lng: number };
  zoom: number;
}

export const useMapView = (userId: string) => {
  const [view, setViewState] = useState<MapView | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`map-view-${userId}`);
        if (stored) {
          setViewState(JSON.parse(stored));
        } else {
          // Default view - centered on British Isles
          setViewState({
            center: { lat: 54.5, lng: -4.0 }, // Central UK
            zoom: 6
          });
        }
      } catch (e) {
        console.error('Error loading map view:', e);
        setViewState({
          center: { lat: 54.5, lng: -4.0 },
          zoom: 6
        });
      }
    }
  }, [userId]);

  const setView = (newView: MapView) => {
    setViewState(newView);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`map-view-${userId}`, JSON.stringify(newView));
      } catch (e) {
        console.error('Error saving map view:', e);
      }
    }
  };

  return { view, setView };
};