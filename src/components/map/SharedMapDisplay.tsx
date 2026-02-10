'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

interface SharedMapDisplayProps {
  center: [number, number]; // [lng, lat]
  pins?: Array<{
    id: string;
    coordinates: [number, number]; // [lng, lat]
    label: string;
  }>;
}

export default function SharedMapDisplay({ center, pins = [] }: SharedMapDisplayProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current).setView([center[1], center[0]], 13);
    mapRef.current = map;

    // Add tile layer
    const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY || '';
    L.tileLayer(`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`, {
      attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
      tileSize: 512,
      zoomOffset: -1,
    }).addTo(map);

    // Add pins
    pins.forEach(pin => {
      const marker = L.marker([pin.coordinates[1], pin.coordinates[0]])
        .addTo(map)
        .bindPopup(pin.label);
      
      // Open popup for the main pin
      if (pins.length === 1) {
        marker.openPopup();
      }
    });

    // Fit bounds if multiple pins
    if (pins.length > 1) {
      const bounds = L.latLngBounds(
        pins.map(pin => [pin.coordinates[1], pin.coordinates[0]])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [center, pins]);

  return (
    <div 
      ref={mapContainerRef} 
      className="w-full h-full min-h-[400px]"
      style={{ zIndex: 1 }}
    />
  );
}