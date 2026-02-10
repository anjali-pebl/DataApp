'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom blue marker icon (matching the OpenLayers style)
const blueIcon = L.divIcon({
  className: 'custom-blue-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
    <path fill="#007bff" stroke="#ffffff" stroke-width="1"
      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13C19 5.13 15.87 2 12 2zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

interface DataExplorerMapProps {
  initialCenter: [number, number]; // [longitude, latitude]
  initialZoom: number;
  selectedCoords?: { lat: number; lon: number } | null;
  onLocationSelect?: (coords: { lat: number; lon: number }) => void;
}

export function DataExplorerMap({
  initialCenter,
  initialZoom,
  selectedCoords,
  onLocationSelect,
}: DataExplorerMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Initialize map
  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      // Convert [lon, lat] to [lat, lon] for Leaflet
      const leafletCenter: [number, number] = [initialCenter[1], initialCenter[0]];

      mapRef.current = L.map(mapContainerRef.current, {
        center: leafletCenter,
        zoom: initialZoom,
        zoomControl: true,
        // Mobile-friendly settings
        tap: true,
        touchZoom: true,
        dragging: true,
      });

      // Add tile layer
      const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY || '';
      L.tileLayer(`https://api.maptiler.com/maps/dataviz/{z}/{x}/{y}.png?key=${maptilerKey}`, {
        attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 20,
        minZoom: 3,
        tileSize: 512,
        zoomOffset: -1,
      }).addTo(mapRef.current);

      // Add click handler
      if (onLocationSelect) {
        mapRef.current.on('click', (e: L.LeafletMouseEvent) => {
          onLocationSelect({ lat: e.latlng.lat, lon: e.latlng.lng });
        });
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Update marker when selectedCoords changes
  useEffect(() => {
    if (mapRef.current && selectedCoords) {
      // Remove existing marker
      if (markerRef.current) {
        markerRef.current.remove();
      }

      // Add new marker
      markerRef.current = L.marker([selectedCoords.lat, selectedCoords.lon], {
        icon: blueIcon,
      }).addTo(mapRef.current);

      // Animate to new position
      mapRef.current.setView([selectedCoords.lat, selectedCoords.lon], mapRef.current.getZoom(), {
        animate: true,
        duration: 0.3,
      });
    } else if (mapRef.current && !selectedCoords && markerRef.current) {
      // Remove marker if no coords
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [selectedCoords]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '100%',
        cursor: 'pointer',
        touchAction: 'manipulation',
        userSelect: 'none',
      }}
      className="relative z-0"
    />
  );
}

export default DataExplorerMap;
