'use client';

import React, { useEffect, useRef, useState, memo } from 'react';
import type { LatLngExpression, Map as LeafletMap, LatLng, DivIconOptions, CircleMarker, Polyline, Polygon, LayerGroup, Popup, LocationEvent, LeafletMouseEvent, CircleMarkerOptions, Tooltip as LeafletTooltip, Marker } from 'leaflet';
import type { Settings } from '@/hooks/use-settings';

// Dynamically import Leaflet only on client-side
let L: any = null;
if (typeof window !== 'undefined') {
  L = require('leaflet');
  // Import CSS using dynamic import to avoid HMR issues
  import('leaflet/dist/leaflet.css');
}

type Project = { id: string; name: string; description?: string; createdAt: any; };
type Tag = { id: string; name: string; color: string; projectId: string; };
type Pin = { id: string; lat: number; lng: number; label: string; labelVisible?: boolean; objectVisible?: boolean; notes?: string; projectId?: string; tagIds?: string[]; };
type Line = { id:string; path: { lat: number; lng: number }[]; label: string; labelVisible?: boolean; objectVisible?: boolean; notes?: string; projectId?: string; tagIds?: string[]; };
type Area = { id: string; path: { lat: number; lng: number }[]; label: string; labelVisible?: boolean; objectVisible?: boolean; notes?: string; fillVisible?: boolean; projectId?: string; tagIds?: string[]; };

interface LeafletMapProps {
    mapRef: React.MutableRefObject<LeafletMap | null>;
    center: LatLngExpression;
    zoom: number;
    pins: Pin[];
    lines: Line[];
    areas: Area[];
    projects: Project[];
    tags: Tag[];
    settings: Settings;
    currentLocation: LatLng | null;
    onLocationFound: (latlng: LatLng) => void;
    onLocationError: (error: any) => void;
    onMove: (center: LatLng, zoom: number, isMoving?: boolean) => void;
    isDrawingLine: boolean;
    lineStartPoint: LatLng | null;
    currentMousePosition?: LatLng | null;
    isDrawingArea: boolean;
    onMapClick: (e: LeafletMouseEvent) => void;
    onMapMouseMove?: (e: LeafletMouseEvent) => void;
    pendingAreaPath: LatLng[];
    areaStartPoint: LatLng | null;
    currentAreaEndPoint: LatLng | null;
    pendingPin: LatLng | null;
    onPinSave: (id: string, label: string, lat: number, lng: number, notes: string, tagId?: string) => void;
    onPinCancel: () => void;
    pendingLine: { path: LatLng[] } | null;
    onLineSave: (id: string, label: string, path: LatLng[], notes: string, tagId?: string) => void;
    onLineCancel: () => void;
    pendingArea: { path: LatLng[] } | null;
    onAreaSave: (id: string, label: string, path: LatLng[], notes: string, tagId?: string) => void;
    onAreaCancel: () => void;
    onUpdatePin: (id: string, label: string, notes: string, projectId?: string, tagIds?: string[]) => void;
    onDeletePin: (id: string) => void;
    onUpdateLine: (id: string, label: string, notes: string, projectId?: string, tagIds?: string[]) => void;
    onDeleteLine: (id: string) => void;
    onUpdateArea: (id: string, label: string, notes: string, path: {lat: number, lng: number}[], projectId?: string, tagIds?: string[]) => void;
    onDeleteArea: (id: string) => void;
    onToggleLabel: (id: string, type: 'pin' | 'line' | 'area') => void;
    onToggleFill: (id: string) => void;
    itemToEdit: Pin | Line | Area | null;
    onEditItem: (item: Pin | Line | Area | null) => void;
    activeProjectId: string | null;
    projectVisibility: Record<string, boolean>;
    editingGeometry: Line | Area | null;
    onEditGeometry: (item: Line | Area | null) => void;
    onUpdateGeometry: (itemId: string, newPath: {lat: number, lng: number}[]) => void;
    // New props to control popup behavior
    showPopups?: boolean;
    useEditPanel?: boolean;
    disableDefaultPopups?: boolean;
    forceUseEditCallback?: boolean;
    popupMode?: 'none' | 'default';
    // Line Edit Mode props
    lineEditMode?: 'none' | 'endpoints';
    editingLineId?: string | null;
    tempLinePath?: { lat: number; lng: number }[] | null;
    onLinePointDrag?: (pointIndex: number, newPosition: LatLng) => void;
    onLineEditComplete?: () => void;
    onLineEditCancel?: () => void;
    // Area Corner Dragging props
    areaEditMode?: 'none' | 'corners';
    editingAreaId?: string | null;
    tempAreaPath?: { lat: number; lng: number }[] | null;
    onAreaCornerDrag?: (cornerIndex: number, newPosition: LatLng) => void;
    // Map ready callback
    onMapReady?: () => void;
    // Map style toggle
    mapStyle?: 'bathymetry' | 'plain';
}

// Coordinate and distance conversion helpers
const toFeet = (meters: number) => meters * 3.28084;

const toDMS = (deg: number, isLat: boolean) => {
  const absolute = Math.abs(deg);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = Math.floor((minutesNotTruncated - minutes) * 60);
  const direction = deg >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
  return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
};

// Helper function to check if a point is inside a polygon
const isPointInPolygon = (point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;

        const intersect = ((yi > point.lat) !== (yj > point.lat))
            && (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

// Helper function to calculate what percentage of viewport an area occupies
const calculateAreaViewportCoverage = (
    area: { path: { lat: number; lng: number }[] },
    mapRef: any
): number => {
    if (!mapRef || !area.path || area.path.length < 3) return 0;

    try {
        const bounds = mapRef.getBounds();
        const viewportNorth = bounds.getNorth();
        const viewportSouth = bounds.getSouth();
        const viewportEast = bounds.getEast();
        const viewportWest = bounds.getWest();

        // Calculate viewport area (rough approximation)
        const viewportLatSpan = viewportNorth - viewportSouth;
        const viewportLngSpan = viewportEast - viewportWest;
        const viewportArea = viewportLatSpan * viewportLngSpan;

        // Calculate area bounds
        const areaLats = area.path.map(p => p.lat);
        const areaLngs = area.path.map(p => p.lng);
        const areaMinLat = Math.min(...areaLats);
        const areaMaxLat = Math.max(...areaLats);
        const areaMinLng = Math.min(...areaLngs);
        const areaMaxLng = Math.max(...areaLngs);

        // Calculate area bounding box
        const areaLatSpan = areaMaxLat - areaMinLat;
        const areaLngSpan = areaMaxLng - areaMinLng;
        const areaBounds = areaLatSpan * areaLngSpan;

        // Return percentage of viewport occupied by area bounds
        return (areaBounds / viewportArea) * 100;
    } catch (error) {
        return 0;
    }
};

// Helper function to check if one polygon is completely inside another polygon
const isPolygonInsidePolygon = (
    innerPolygon: { lat: number; lng: number }[],
    outerPolygon: { lat: number; lng: number }[]
): boolean => {
    // Check if all points of the inner polygon are inside the outer polygon
    return innerPolygon.every(point => isPointInPolygon(point, outerPolygon));
};

// Helper function to determine if labels should be visible based on zoom and context
const shouldShowLabel = (
    objectType: 'pin' | 'line' | 'area',
    zoom: number,
    position: { lat: number; lng: number } | { lat: number; lng: number }[],
    areas: Area[],
    mapRef: any,
    currentAreaId?: string, // For checking nested areas
    debugLabel?: string, // For debugging
    activeLicenseAreaId?: string | null // Active License area ID for visibility override
): boolean => {
    // For areas, check if they're nested in another area
    if (objectType === 'area' && Array.isArray(position)) {
        // Find if this area is inside another area
        const containingArea = areas.find(area =>
            area.id !== currentAreaId && // Don't check against itself
            area.path &&
            isPolygonInsidePolygon(position, area.path)
        );

        if (containingArea) {
            // If we just auto-fitted to this License area, always show nested areas
            if (activeLicenseAreaId && containingArea.id === activeLicenseAreaId) {
                if (debugLabel) {
                    console.log(`[Visibility] Nested area "${debugLabel}": inside active License area "${containingArea.label}" - FORCE VISIBLE`);
                }
                return true;
            }

            // Area is nested - check if parent area covers 10%+ of viewport
            const coverage = calculateAreaViewportCoverage(containingArea, mapRef);
            const visible = coverage >= 10;
            if (debugLabel) {
                console.log(`[Visibility] Nested area "${debugLabel}": parent="${containingArea.label}" coverage=${coverage.toFixed(1)}% visible=${visible}`);
            }
            return visible;
        }

        // Top-level area - always show
        if (debugLabel) {
            console.log(`[Visibility] Top-level area "${debugLabel}": always visible`);
        }
        return true;
    }

    // For pins and lines, check zoom level and area coverage
    const point = Array.isArray(position)
        ? { lat: position[0].lat, lng: position[0].lng }
        : position;

    // Find which area (if any) contains this object
    const containingArea = areas.find(area =>
        area.path && isPointInPolygon(point, area.path)
    );

    if (containingArea) {
        // If we just auto-fitted to this License area, always show elements inside it
        if (activeLicenseAreaId && containingArea.id === activeLicenseAreaId) {
            if (debugLabel) {
                console.log(`[Visibility] ${objectType} "${debugLabel}": inside active License area "${containingArea.label}" - FORCE VISIBLE`);
            }
            return true;
        }

        // Object is inside an area - check if area covers 10%+ of viewport
        const coverage = calculateAreaViewportCoverage(containingArea, mapRef);
        const visible = coverage >= 10;
        if (debugLabel) {
            console.log(`[Visibility] ${objectType} "${debugLabel}": inside="${containingArea.label}" coverage=${coverage.toFixed(1)}% visible=${visible}`);
        }
        return visible;
    }

    // Object is not in any area - use simple zoom thresholds
    if (objectType === 'line') {
        return zoom >= 13; // Show line labels at medium zoom
    }

    // Pin labels
    return zoom >= 14; // Show pin labels at high zoom
};

const createCustomIcon = (color: string, size: number = 6) => {
    // Map pin size values (3, 6, 10) to pixel sizes
    const sizeMap = { 3: 24, 6: 36, 10: 48 };
    const pixelSize = sizeMap[size as keyof typeof sizeMap] || 36;
    
    const iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="${pixelSize}" height="${pixelSize}" class="drop-shadow-lg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
    
    const iconOptions: DivIconOptions = {
      html: iconHtml,
      className: 'border-0 bg-transparent',
      iconSize: [pixelSize, pixelSize],
      iconAnchor: [pixelSize / 2, pixelSize],
      popupAnchor: [0, -pixelSize - 2]
    };

    return L.divIcon(iconOptions as any);
};

const createDraggableVertexIcon = () => {
    const iconHtml = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="background: hsl(var(--primary)); border-radius: 50%; border: 2px solid hsl(var(--primary-foreground)); box-shadow: 0 0 5px rgba(0,0,0,0.5);"><circle cx="8" cy="8" r="8" fill="transparent"/></svg>`;
    return L.divIcon({
        html: iconHtml,
        className: 'bg-transparent border-0',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
};

const createDraggableCornerIcon = (cornerNumber: number, color: string = '#3b82f6') => {
    const iconHtml = `
        <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <!-- Outer circle with shadow -->
            <circle cx="12" cy="12" r="11" fill="${color}" opacity="0.9" stroke="white" stroke-width="2" filter="url(#shadow${cornerNumber})"/>
            <!-- Corner number -->
            <text x="12" y="16" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="white" text-anchor="middle">${cornerNumber}</text>
            <!-- Shadow filter -->
            <defs>
                <filter id="shadow${cornerNumber}" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
                    <feOffset dx="0" dy="2" result="offsetblur"/>
                    <feComponentTransfer>
                        <feFuncA type="linear" slope="0.5"/>
                    </feComponentTransfer>
                    <feMerge>
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
        </svg>
    `;
    return L.divIcon({
        html: iconHtml,
        className: 'bg-transparent border-0 cursor-move',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
};

// Line distance calculation
export function calculateLineDistance(path: { lat: number; lng: number }[]): number {
    if (path.length < 2 || !L) {
        return 0;
    }
    
    let totalDistance = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const point1 = L.latLng(path[i].lat, path[i].lng);
        const point2 = L.latLng(path[i + 1].lat, path[i + 1].lng);
        totalDistance += point1.distanceTo(point2);
    }
    
    return totalDistance; // Returns distance in meters
}

// Shoelace formula implementation for area calculation
function calculatePolygonArea(path: { lat: number; lng: number }[]): number {
    if (path.length < 3) {
      return 0;
    }

    const points = [...path];
    if (points[0].lat !== points[points.length - 1].lat || points[0].lng !== points[points.length - 1].lng) {
      points.push(points[0]);
    }

    let area = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        area += (p1.lng * p2.lat - p2.lng * p1.lat);
    }
    const areaSqDegrees = Math.abs(area / 2);

    const avgLatRad = (path.reduce((sum, p) => sum + p.lat, 0) / path.length) * (Math.PI / 180);
    const metersPerDegreeLat = 111132.954 - 559.822 * Math.cos(2 * avgLatRad) + 1.175 * Math.cos(4 * avgLatRad);
    const metersPerDegreeLng = 111320 * Math.cos(avgLatRad);
    const areaSqMeters = areaSqDegrees * metersPerDegreeLat * metersPerDegreeLng;
    
    return areaSqMeters / 10000; // Convert to hectares
}

const LeafletMap = ({
    mapRef, center, zoom, pins, lines, areas, projects, tags, settings, currentLocation,
    onLocationFound, onLocationError, onMove, isDrawingLine, lineStartPoint, currentMousePosition,
    isDrawingArea, onMapClick, onMapMouseMove, pendingAreaPath, areaStartPoint, currentAreaEndPoint,
    pendingPin, onPinSave, onPinCancel,
    pendingLine, onLineSave, onLineCancel,
    pendingArea, onAreaSave, onAreaCancel,
    onUpdatePin, onDeletePin, onUpdateLine, onDeleteLine, onUpdateArea, onDeleteArea, onToggleLabel, onToggleFill,
    itemToEdit, onEditItem, activeProjectId, projectVisibility,
    editingGeometry, onEditGeometry, onUpdateGeometry,
    showPopups = true, useEditPanel = false, disableDefaultPopups = false, forceUseEditCallback = false, popupMode = 'default',
    lineEditMode = 'none', editingLineId = null, tempLinePath = null, onLinePointDrag, onLineEditComplete, onLineEditCancel,
    areaEditMode = 'none', editingAreaId = null, tempAreaPath = null, onAreaCornerDrag,
    onMapReady,
    mapStyle = 'street'
}: LeafletMapProps) => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const pinLayerRef = useRef<LayerGroup | null>(null);
    const lineLayerRef = useRef<LayerGroup | null>(null);
    const hasInitializedRef = useRef(false);
    const hasInitialProjectZoomRef = useRef(false); // Track if we've done initial zoom to active project
    const activeLicenseAreaRef = useRef<string | null>(null); // Track active License area for visibility override

    // Return early if Leaflet is not available (SSR)
    if (!L) {
        return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} className="flex items-center justify-center text-muted-foreground">Loading map...</div>;
    }
    const areaLayerRef = useRef<LayerGroup | null>(null);
    const previewLineRef = useRef<Polyline | null>(null);
    const livePreviewLineRef = useRef<Polyline | null>(null);
    const previewAreaRef = useRef<Polygon | null>(null);
    const previewAreaLineRef = useRef<Polyline | null>(null);
    const liveAreaPreviewRef = useRef<Polyline | null>(null);
    const areaDistanceTooltipRef = useRef<LeafletTooltip | null>(null);
    const currentLocationMarkerRef = useRef<CircleMarker | null>(null);
    const popupRef = useRef<Popup | null>(null);
    const previewAreaPointsRef = useRef<LayerGroup | null>(null);
    const distanceTooltipRef = useRef<LeafletTooltip | null>(null);
    const linePopupActiveRef = useRef<boolean>(false);
    const lineSavingRef = useRef<boolean>(false);
    const areaSavingRef = useRef<boolean>(false);
    const pinSavingRef = useRef<boolean>(false);
    const editingLayerRef = useRef<LayerGroup | null>(null);
    const tileLayerRef = useRef<any>(null);
    const [editedPath, setEditedPath] = useState<{lat: number, lng: number}[] | null>(null);

    // Initialize map
    useEffect(() => {
        // Prevent multiple initializations
        if (hasInitializedRef.current || mapRef.current) return
        if (!mapContainerRef.current) return

        hasInitializedRef.current = true
        // console.log('Initializing Leaflet map...');

        try{
            const map = L.map(mapContainerRef.current, {
                center: center,
                zoom: zoom,
                zoomControl: false, // Disable default zoom controls
                doubleClickZoom: false // Disable double-click zoom to allow custom label interactions
            });
            mapRef.current = map;

                const esriKey = process.env.NEXT_PUBLIC_ESRI_API_KEY || '';
                const initialUrl = mapStyle === 'plain'
                    ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`
                    : `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`;
                tileLayerRef.current = L.tileLayer(initialUrl, {
                    attribution: 'Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors',
                    maxZoom: 20,
                }).addTo(map);
                
                pinLayerRef.current = L.layerGroup().addTo(map);
                lineLayerRef.current = L.layerGroup().addTo(map);
                areaLayerRef.current = L.layerGroup().addTo(map);

                // Add event handlers
                if (onMapClick) {
                    map.on('click', onMapClick);
                }
                if (onMapMouseMove) {
                    map.on('mousemove', onMapMouseMove);
                }
                if (onMove) {
                    // Use requestAnimationFrame for smooth, throttled updates during dragging
                    let rafId: number | null = null;
                    let isThrottling = false;

                    map.on('move', () => {
                        // Skip if already scheduled
                        if (isThrottling) return;

                        isThrottling = true;

                        // Use requestAnimationFrame for smooth 60fps updates
                        rafId = requestAnimationFrame(() => {
                            const center = map.getCenter();
                            const zoom = map.getZoom();
                            // Pass isMoving=true for continuous movement
                            onMove(center, zoom, true);
                            isThrottling = false;
                            rafId = null;
                        });
                    });

                    map.on('moveend', () => {
                        // Cancel any pending animation frame
                        if (rafId !== null) {
                            cancelAnimationFrame(rafId);
                            rafId = null;
                        }
                        isThrottling = false;

                        // Fire immediately on moveend with isMoving=false
                        const center = map.getCenter();
                        const zoom = map.getZoom();
                        onMove(center, zoom, false);
                    });
                }

                // console.log('Leaflet map initialized successfully');

                // Force resize after a short delay and notify parent that map is ready
                setTimeout(() => {
                    if (mapRef.current) {
                        mapRef.current.invalidateSize();
                        // Notify parent that map is fully initialized
                        onMapReady?.();
                    }
                }, 100);

        } catch (error) {
            console.error('Error initializing Leaflet map:', error);
            hasInitializedRef.current = false // Reset on error
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                hasInitializedRef.current = false;
            }
        };
    }, []); // Only run once

    // Swap tile layer when mapStyle changes
    useEffect(() => {
        if (!tileLayerRef.current) return;
        const esriKey = process.env.NEXT_PUBLIC_ESRI_API_KEY || '';
        const url = mapStyle === 'plain'
            ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`
            : `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`;
        tileLayerRef.current.setUrl(url);
    }, [mapStyle]);

    // Initial zoom to fit active project content (runs when page loads/reloads)
    useEffect(() => {
        // Only run once per page visit, when map is ready and we have an active project
        if (hasInitialProjectZoomRef.current || !mapRef.current || !activeProjectId) return;

        // Find the main License area for the active project
        const projectAreas = areas.filter(a => a.projectId === activeProjectId);

        // Look for a License area first (matches double-click behavior)
        const licenseArea = projectAreas.find(a =>
            a.label && a.label.toLowerCase().includes('license') && a.path && a.path.length >= 3
        );

        // If no License area, use any area with a valid path
        const targetArea = licenseArea || projectAreas.find(a => a.path && a.path.length >= 3);

        if (!targetArea || !targetArea.path) {
            return;
        }

        hasInitialProjectZoomRef.current = true;

        // Set this as the active License area to force visibility of nested items
        activeLicenseAreaRef.current = targetArea.id;

        // Calculate bounds from area path
        const lats = targetArea.path.map(p => p.lat);
        const lngs = targetArea.path.map(p => p.lng);
        const bounds = L.latLngBounds(
            L.latLng(Math.min(...lats), Math.min(...lngs)),
            L.latLng(Math.max(...lats), Math.max(...lngs))
        );

        // Fit bounds with padding
        mapRef.current.fitBounds(bounds, {
            padding: [50, 50],
            animate: false
        });

        // Trigger moveend to update visibility
        mapRef.current.fire('moveend');

        // Clear active License area after a delay
        setTimeout(() => {
            activeLicenseAreaRef.current = null;
            if (mapRef.current) {
                mapRef.current.fire('moveend');
            }
        }, 600);

        // Reset zoom flag when component unmounts (so it zooms again when navigating back)
        return () => {
            hasInitialProjectZoomRef.current = false;
        };
    }, [activeProjectId, areas]);

    // Render pins with click handlers for deletion
    useEffect(() => {
        if (pinLayerRef.current) {
            const layer = pinLayerRef.current;
            layer.clearLayers();

            pins.filter(pin => typeof pin.lat === 'number' && typeof pin.lng === 'number' &&
                               !isNaN(pin.lat) && !isNaN(pin.lng) &&
                               isFinite(pin.lat) && isFinite(pin.lng) &&
                               pin.objectVisible !== false).forEach(pin => {
                // Check if pin should be visible based on zoom and area coverage
                const shouldBeVisible = shouldShowLabel('pin', zoom, { lat: pin.lat, lng: pin.lng }, areas, mapRef.current, undefined, pin.label, activeLicenseAreaRef.current);

                if (!shouldBeVisible) return; // Skip rendering this pin

                const color = pin.color || '#3b82f6'; // Use pin color or default blue
                const size = pin.size || 6; // Use pin size or default medium
                const markerIcon = createCustomIcon(color, size);
                const marker = L.marker([pin.lat, pin.lng], { icon: markerIcon }).addTo(layer);
                
                // Add click handler for pin
                marker.on('click', (e) => {
                    e.originalEvent.stopPropagation(); // Prevent map click
                    
                    // Use edit panel if configured, otherwise show popup
                    if (useEditPanel || disableDefaultPopups || forceUseEditCallback || popupMode === 'none') {
                        onEditItem(pin);
                        return;
                    }
                    
                    // Show edit/delete options popup (legacy behavior)
                    const actionContent = `
                        <div style="padding: 8px; text-align: center;">
                            <p style="margin: 0 0 8px 0; font-weight: bold;">Pin Options</p>
                            <p style="margin: 0 0 12px 0; font-size: 12px; color: #666;">${pin.label}</p>
                            <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                                <button id="edit-pin-${pin.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #3b82f6; color: white; border: none; cursor: pointer;">Edit</button>
                                <button id="toggle-label-pin-${pin.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #10b981; color: white; border: none; cursor: pointer;">${pin.labelVisible !== false ? 'Hide Label' : 'Show Label'}</button>
                                <button id="delete-pin-${pin.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #ef4444; color: white; border: none; cursor: pointer;">Delete</button>
                                <button id="cancel-pin-${pin.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                            </div>
                        </div>
                    `;
                    
                    const popup = L.popup({ closeButton: false, closeOnClick: false })
                        .setLatLng([pin.lat, pin.lng])
                        .setContent(actionContent)
                        .openOn(mapRef.current!);
                    
                    // Add event listeners after popup is added to DOM
                    setTimeout(() => {
                        const editBtn = document.getElementById(`edit-pin-${pin.id}`);
                        const toggleLabelBtn = document.getElementById(`toggle-label-pin-${pin.id}`);
                        const deleteBtn = document.getElementById(`delete-pin-${pin.id}`);
                        const cancelBtn = document.getElementById(`cancel-pin-${pin.id}`);
                        
                        editBtn?.addEventListener('click', () => {
                            onEditItem(pin);
                            mapRef.current?.closePopup();
                        });
                        
                        toggleLabelBtn?.addEventListener('click', () => {
                            onToggleLabel(pin.id, 'pin');
                            mapRef.current?.closePopup();
                        });
                        
                        deleteBtn?.addEventListener('click', () => {
                            onDeletePin(pin.id);
                            mapRef.current?.closePopup();
                        });
                        
                        cancelBtn?.addEventListener('click', () => {
                            mapRef.current?.closePopup();
                        });
                    }, 0);
                });
                
                if (pin.labelVisible !== false && pin.label) {
                    // Check if label should be shown based on zoom and area coverage
                    const showLabel = shouldShowLabel('pin', zoom, { lat: pin.lat, lng: pin.lng }, areas, mapRef.current);

                    if (showLabel) {
                        const tooltip = marker.bindTooltip(pin.label, {
                            permanent: true,
                            direction: 'top',
                            offset: [0, -36],
                            className: 'font-sans font-bold cursor-pointer'
                        });

                        // Make tooltip clickable for deletion
                        const tooltipElement = tooltip.getTooltip();
                        if (tooltipElement) {
                            tooltipElement.on('click', (e) => {
                                e.originalEvent.stopPropagation();
                                marker.fire('click', e); // Trigger the same deletion logic
                            });
                        }
                    }
                }
            });
        }
    }, [pins, zoom, areas, onEditItem, useEditPanel, disableDefaultPopups, forceUseEditCallback, popupMode]);

    // Render lines
    useEffect(() => {
        if (lineLayerRef.current) {
            const layer = lineLayerRef.current;
            layer.clearLayers();

            lines.filter(line => line.objectVisible !== false).forEach(line => {
                const lineCoords = line.path
                    .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number' &&
                                !isNaN(p.lat) && !isNaN(p.lng) &&
                                isFinite(p.lat) && isFinite(p.lng))
                    .map(p => [p.lat, p.lng] as [number, number]);
                if (lineCoords.length >= 2) {
                    // Check if line should be visible based on zoom and area coverage
                    const linePoints = line.path.map(p => ({ lat: p.lat, lng: p.lng }));
                    const shouldBeVisible = shouldShowLabel('line', zoom, linePoints, areas, mapRef.current, undefined, line.label, activeLicenseAreaRef.current);

                    if (!shouldBeVisible) return; // Skip rendering this line

                    // Create an invisible wider line underneath for easier clicking
                    const clickableLine = L.polyline(lineCoords, {
                        color: 'transparent',
                        weight: 15, // Wide invisible line for easier clicking
                        opacity: 0,
                        interactive: true
                    }).addTo(layer);

                    // Create the visible line
                    const polyline = L.polyline(lineCoords, {
                        color: line.color || '#10b981',
                        weight: line.size || 3,
                        opacity: 0.8,
                        interactive: false // Visual line is not interactive
                    }).addTo(layer);

                    // Add click handler for the invisible wider line
                    clickableLine.on('click', (e) => {
                        e.originalEvent.stopPropagation(); // Prevent map click
                        
                        // Use edit panel if configured, otherwise show popup
                        if (useEditPanel || disableDefaultPopups || forceUseEditCallback || popupMode === 'none') {
                            onEditItem(line);
                            return;
                        }
                        
                        // Show edit/delete options popup (legacy behavior)
                        const actionContent = `
                            <div style="padding: 8px; text-align: center;">
                                <p style="margin: 0 0 8px 0; font-weight: bold;">Line Options</p>
                                <p style="margin: 0 0 12px 0; font-size: 12px; color: #666;">${line.label}</p>
                                <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                                    <button id="edit-line-${line.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #3b82f6; color: white; border: none; cursor: pointer;">Edit</button>
                                    <button id="toggle-label-line-${line.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #10b981; color: white; border: none; cursor: pointer;">${line.labelVisible !== false ? 'Hide Label' : 'Show Label'}</button>
                                    <button id="delete-line-${line.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #ef4444; color: white; border: none; cursor: pointer;">Delete</button>
                                    <button id="cancel-line-${line.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                                </div>
                            </div>
                        `;
                        
                        const midPoint = L.latLng(
                            lineCoords.reduce((sum, coord) => sum + coord[0], 0) / lineCoords.length,
                            lineCoords.reduce((sum, coord) => sum + coord[1], 0) / lineCoords.length
                        );
                        
                        const popup = L.popup({ closeButton: false, closeOnClick: false })
                            .setLatLng(midPoint)
                            .setContent(actionContent)
                            .openOn(mapRef.current!);
                        
                        // Add event listeners after popup is added to DOM
                        setTimeout(() => {
                            const editBtn = document.getElementById(`edit-line-${line.id}`);
                            const toggleLabelBtn = document.getElementById(`toggle-label-line-${line.id}`);
                            const deleteBtn = document.getElementById(`delete-line-${line.id}`);
                            const cancelBtn = document.getElementById(`cancel-line-${line.id}`);
                            
                            editBtn?.addEventListener('click', () => {
                                onEditItem(line);
                                mapRef.current?.closePopup();
                            });
                            
                            toggleLabelBtn?.addEventListener('click', () => {
                                onToggleLabel(line.id, 'line');
                                mapRef.current?.closePopup();
                            });
                            
                            deleteBtn?.addEventListener('click', () => {
                                onDeleteLine(line.id);
                                mapRef.current?.closePopup();
                            });
                            
                            cancelBtn?.addEventListener('click', () => {
                                mapRef.current?.closePopup();
                            });
                        }, 0);
                    });
                    
                    if (line.labelVisible !== false && line.label) {
                        // Check if label should be shown based on zoom and area coverage
                        const linePoints = line.path.map(p => ({ lat: p.lat, lng: p.lng }));
                        const showLabel = shouldShowLabel('line', zoom, linePoints, areas, mapRef.current);

                        if (showLabel) {
                            // Calculate the true geometric center of the line
                            let totalDistance = 0;
                            const distances: number[] = [];

                            // Calculate distances between consecutive points
                            for (let i = 0; i < lineCoords.length - 1; i++) {
                                const point1 = L.latLng(lineCoords[i][0], lineCoords[i][1]);
                                const point2 = L.latLng(lineCoords[i + 1][0], lineCoords[i + 1][1]);
                                const segmentDistance = point1.distanceTo(point2);
                                distances.push(segmentDistance);
                                totalDistance += segmentDistance;
                            }

                            // Find the point at half the total distance
                            const halfDistance = totalDistance / 2;
                            let accumulatedDistance = 0;
                            let centerPoint = lineCoords[0];

                            for (let i = 0; i < distances.length; i++) {
                                if (accumulatedDistance + distances[i] >= halfDistance) {
                                    // The center point is somewhere along this segment
                                    const segmentRatio = (halfDistance - accumulatedDistance) / distances[i];
                                    const point1 = lineCoords[i];
                                    const point2 = lineCoords[i + 1];

                                    // Interpolate between the two points
                                    centerPoint = [
                                        point1[0] + (point2[0] - point1[0]) * segmentRatio,
                                        point1[1] + (point2[1] - point1[1]) * segmentRatio
                                    ];
                                    break;
                                }
                                accumulatedDistance += distances[i];
                            }

                            // Create a permanent tooltip at the true geometric center
                            if (centerPoint && centerPoint.length === 2 &&
                                !isNaN(centerPoint[0]) && !isNaN(centerPoint[1]) &&
                                isFinite(centerPoint[0]) && isFinite(centerPoint[1])) {
                                const tooltip = L.tooltip({
                                    permanent: true,
                                    direction: 'center',
                                    className: 'line-label-tooltip cursor-pointer'
                                })
                                    .setContent(line.label)
                                    .setLatLng([centerPoint[0], centerPoint[1]])
                                    .addTo(layer);

                                // Make tooltip clickable for selection
                                tooltip.on('click', (e) => {
                                    e.originalEvent.stopPropagation();
                                    clickableLine.fire('click', e); // Trigger the same selection logic as the clickable line
                                });
                            }
                        }
                    }
                }
            });
        }
    }, [lines, zoom, areas, onEditItem, useEditPanel, disableDefaultPopups, forceUseEditCallback, popupMode]);

    // Line Edit Mode - Refs for persistent marker storage
    const lineEditMarkersRef = useRef<Marker[]>([]);
    const lineEditLayerRef = useRef<Polyline | null>(null);
    const lineEditPathRef = useRef<{ lat: number; lng: number }[] | null>(null);
    const isDraggingLinePointRef = useRef(false);

    // Line Edit Mode - Create/Remove markers based on mode and line ID
    useEffect(() => {
        if (!mapRef.current || !L || lineEditMode === 'none' || !editingLineId || !tempLinePath) {
            // Cleanup if exiting edit mode
            lineEditMarkersRef.current.forEach(marker => marker.remove());
            lineEditMarkersRef.current = [];
            if (lineEditLayerRef.current) {
                lineEditLayerRef.current.remove();
                lineEditLayerRef.current = null;
            }
            lineEditPathRef.current = null;
            return;
        }

        // Only recreate markers if we're editing a different line or entering edit mode for first time
        const isNewEditSession = lineEditMarkersRef.current.length === 0;

        if (!isNewEditSession) {
            // Just update positions of existing markers and line - don't recreate
            return;
        }

        console.log('🎯 Line Edit Mode: Setting up draggable markers for line', editingLineId);
        console.log('🎯 Initial temp path:', tempLinePath);

        // Store path in ref
        lineEditPathRef.current = [...tempLinePath];

        // Draw the temporary line first
        lineEditLayerRef.current = L.polyline(
            lineEditPathRef.current.map(p => [p.lat, p.lng] as [number, number]),
            {
                color: '#3b82f6',
                weight: 4,
                opacity: 0.6,
                dashArray: '10, 5'
            }
        ).addTo(mapRef.current);

        // Function to update the temporary line
        const updateTempLine = (index: number, newPos: LatLng) => {
            if (!lineEditPathRef.current) return;

            lineEditPathRef.current[index] = {
                lat: newPos.lat,
                lng: newPos.lng
            };

            if (lineEditLayerRef.current) {
                lineEditLayerRef.current.setLatLngs(
                    lineEditPathRef.current.map(p => [p.lat, p.lng] as [number, number])
                );
            }
        };

        // Create draggable markers for endpoints
        tempLinePath.forEach((point, index) => {
            // Only show endpoints for now
            if (index === 0 || index === tempLinePath.length - 1) {
                const marker = L.marker([point.lat, point.lng], {
                    draggable: true,
                    icon: L.divIcon({
                        className: 'line-edit-point',
                        html: `<div style="width: 16px; height: 16px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: grab;"></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    }),
                    // Important: Keep marker on top
                    zIndexOffset: 1000
                }).addTo(mapRef.current!);

                marker.on('dragstart', (e: any) => {
                    isDraggingLinePointRef.current = true;
                    console.log(`🎯 Started dragging point ${index} at:`, e.target.getLatLng());
                });

                marker.on('drag', (e: any) => {
                    if (!isDraggingLinePointRef.current) return;

                    const newPos = e.target.getLatLng();
                    // Update the line visualization immediately for smooth dragging
                    updateTempLine(index, newPos);
                });

                marker.on('dragend', (e: any) => {
                    isDraggingLinePointRef.current = false;
                    const finalPos = e.target.getLatLng();
                    console.log(`🎯 Finished dragging point ${index} at:`, finalPos);

                    // Final update to ensure sync
                    updateTempLine(index, finalPos);

                    // Only update parent state when dragging is complete
                    if (onLinePointDrag) {
                        onLinePointDrag(index, finalPos);
                    }
                });

                lineEditMarkersRef.current.push(marker);
            }
        });

        console.log(`🎯 Line Edit Mode: Created ${lineEditMarkersRef.current.length} draggable markers`);

        return () => {
            console.log('🎯 Line Edit Mode: Cleaning up');
            // Cleanup
            lineEditMarkersRef.current.forEach(marker => marker.remove());
            lineEditMarkersRef.current = [];
            if (lineEditLayerRef.current) {
                lineEditLayerRef.current.remove();
                lineEditLayerRef.current = null;
            }
            lineEditPathRef.current = null;
        };
    }, [lineEditMode, editingLineId]); // Removed tempLinePath from dependencies!

    // Update marker positions when tempLinePath changes (but don't recreate markers)
    useEffect(() => {
        if (!tempLinePath || isDraggingLinePointRef.current || lineEditMarkersRef.current.length === 0) {
            return;
        }

        // Update marker positions without recreating them
        tempLinePath.forEach((point, index) => {
            if (index === 0 || index === tempLinePath.length - 1) {
                const markerIndex = index === 0 ? 0 : 1;
                const marker = lineEditMarkersRef.current[markerIndex];
                if (marker) {
                    const currentPos = marker.getLatLng();
                    // Only update if position actually changed to avoid unnecessary updates
                    if (Math.abs(currentPos.lat - point.lat) > 0.000001 ||
                        Math.abs(currentPos.lng - point.lng) > 0.000001) {
                        marker.setLatLng([point.lat, point.lng]);
                    }
                }
            }
        });

        // Update line path
        if (lineEditLayerRef.current && lineEditPathRef.current) {
            lineEditPathRef.current = [...tempLinePath];
            lineEditLayerRef.current.setLatLngs(
                lineEditPathRef.current.map(p => [p.lat, p.lng] as [number, number])
            );
        }
    }, [tempLinePath]);

    // Render areas
    useEffect(() => {
        if (areaLayerRef.current) {
            const layer = areaLayerRef.current;
            layer.clearLayers();

            areas.filter(area => area.objectVisible !== false).forEach(area => {
                const areaCoords = area.path
                    .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number' &&
                                !isNaN(p.lat) && !isNaN(p.lng) &&
                                isFinite(p.lat) && isFinite(p.lng))
                    .map(p => [p.lat, p.lng] as [number, number]);
                if (areaCoords.length >= 3) {
                    // Check if area should be visible based on nesting
                    const areaPoints = area.path.map(p => ({ lat: p.lat, lng: p.lng }));
                    const shouldBeVisible = shouldShowLabel('area', zoom, areaPoints, areas, mapRef.current, area.id, area.label, activeLicenseAreaRef.current);

                    if (!shouldBeVisible) return; // Skip rendering this nested area

                    const areaColor = area.color || '#8b5cf6';
                    const polygon = L.polygon(areaCoords, {
                        color: areaColor,
                        weight: area.size || 2,
                        fillColor: areaColor,
                        fillOpacity: area.fillVisible !== false ? (area.transparency !== undefined ? area.transparency / 100 : 0.2) : 0
                    }).addTo(layer);
                    
                    // Add click handler for area
                    polygon.on('click', (e) => {
                        e.originalEvent.stopPropagation(); // Prevent map click
                        
                        // Use edit panel if configured, otherwise show popup
                        if (useEditPanel || disableDefaultPopups || forceUseEditCallback || popupMode === 'none') {
                            onEditItem(area);
                            return;
                        }
                        
                        // Show edit/delete options popup (legacy behavior)
                        const actionContent = `
                            <div style="padding: 8px; text-align: center;">
                                <p style="margin: 0 0 8px 0; font-weight: bold;">Area Options</p>
                                <p style="margin: 0 0 12px 0; font-size: 12px; color: #666;">${area.label}</p>
                                <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                                    <button id="edit-area-${area.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #3b82f6; color: white; border: none; cursor: pointer;">Edit</button>
                                    <button id="toggle-label-area-${area.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #10b981; color: white; border: none; cursor: pointer;">${area.labelVisible !== false ? 'Hide Label' : 'Show Label'}</button>
                                    <button id="delete-area-${area.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #ef4444; color: white; border: none; cursor: pointer;">Delete</button>
                                    <button id="cancel-area-${area.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                                </div>
                            </div>
                        `;
                        
                        const centerPoint = L.latLng(
                            areaCoords.reduce((sum, coord) => sum + coord[0], 0) / areaCoords.length,
                            areaCoords.reduce((sum, coord) => sum + coord[1], 0) / areaCoords.length
                        );
                        
                        const popup = L.popup({ closeButton: false, closeOnClick: false })
                            .setLatLng(centerPoint)
                            .setContent(actionContent)
                            .openOn(mapRef.current!);
                        
                        // Add event listeners after popup is added to DOM
                        setTimeout(() => {
                            const editBtn = document.getElementById(`edit-area-${area.id}`);
                            const toggleLabelBtn = document.getElementById(`toggle-label-area-${area.id}`);
                            const deleteBtn = document.getElementById(`delete-area-${area.id}`);
                            const cancelBtn = document.getElementById(`cancel-area-${area.id}`);
                            
                            editBtn?.addEventListener('click', () => {
                                onEditItem(area);
                                mapRef.current?.closePopup();
                            });
                            
                            toggleLabelBtn?.addEventListener('click', () => {
                                onToggleLabel(area.id, 'area');
                                mapRef.current?.closePopup();
                            });
                            
                            deleteBtn?.addEventListener('click', () => {
                                onDeleteArea(area.id);
                                mapRef.current?.closePopup();
                            });
                            
                            cancelBtn?.addEventListener('click', () => {
                                mapRef.current?.closePopup();
                            });
                        }, 0);
                    });
                    
                    if (area.labelVisible !== false && area.label) {
                        const tooltip = polygon.bindTooltip(area.label, {
                            permanent: true,
                            direction: 'center',
                            className: 'font-sans font-bold bg-purple-100 border-purple-300 cursor-pointer area-label-tooltip',
                            interactive: true  // Make tooltip interactive
                        });

                        // Make tooltip clickable for selection
                        const tooltipElement = tooltip.getTooltip();
                        if (tooltipElement) {
                            // Single click: select/edit
                            tooltipElement.on('click', (e) => {
                                e.originalEvent.stopPropagation();
                                polygon.fire('click', e); // Trigger the same selection logic as the polygon
                            });

                            // Double-click handler for License areas
                            if (area.label && area.label.toLowerCase().includes('license')) {
                                tooltipElement.on('dblclick', (e) => {
                                    e.originalEvent.stopPropagation();
                                    e.originalEvent.preventDefault();

                                    if (mapRef.current) {
                                        console.log('=== LABEL DOUBLE-CLICK AUTO-FIT ===');
                                        console.log('Label:', area.label);
                                        console.log('Area ID:', area.id);

                                        // Set this as the active License area to force visibility
                                        activeLicenseAreaRef.current = area.id;

                                        const bounds = polygon.getBounds();

                                        // Fit bounds with animation
                                        mapRef.current.fitBounds(bounds, {
                                            padding: [50, 50],
                                            animate: true,
                                            duration: 0.5
                                        });

                                        // Immediately trigger a re-render to show nested elements
                                        mapRef.current.fire('moveend');

                                        // After fitBounds animation completes, clear the active License area
                                        setTimeout(() => {
                                            if (mapRef.current) {
                                                activeLicenseAreaRef.current = null;
                                                mapRef.current.fire('moveend');
                                            }
                                        }, 800);
                                    }
                                });
                            }
                        }
                    }

                    // Double-click handler: Auto-fit to polygon if label contains "License"
                    if (area.label && area.label.toLowerCase().includes('license')) {
                        polygon.on('dblclick', (e) => {
                            console.log('=== DOUBLE-CLICK AUTO-FIT ===');
                            console.log('Label:', area.label);
                            console.log('Area ID:', area.id);
                            console.log('Contains "license":', area.label.toLowerCase().includes('license'));

                            L.DomEvent.stopPropagation(e);
                            L.DomEvent.preventDefault(e);

                            if (mapRef.current) {
                                // Set this as the active License area to force visibility
                                activeLicenseAreaRef.current = area.id;
                                console.log('Set active License area:', area.id);

                                const bounds = polygon.getBounds();
                                console.log('Bounds:', bounds);
                                console.log('Current zoom before fit:', mapRef.current.getZoom());

                                // Check what polygons are inside this license area
                                const nestedAreas = areas.filter(a => {
                                    if (a.id === area.id || !a.path) return false;
                                    const aPoints = a.path.map(p => ({ lat: p.lat, lng: p.lng }));
                                    const isNested = isPolygonInsidePolygon(aPoints, area.path);
                                    if (isNested) {
                                        console.log('  ✓ Found nested area:', a.label);
                                    }
                                    return isNested;
                                });
                                console.log(`Found ${nestedAreas.length} nested areas inside "${area.label}"`);

                                // Fit bounds with animation
                                mapRef.current.fitBounds(bounds, {
                                    padding: [50, 50],
                                    animate: true,
                                    duration: 0.5
                                });

                                // Immediately trigger a re-render to show nested elements
                                mapRef.current.fire('moveend');

                                // After fitBounds animation completes, clear the active License area
                                setTimeout(() => {
                                    if (mapRef.current) {
                                        const newZoom = mapRef.current.getZoom();
                                        console.log('After fit - new zoom:', newZoom);
                                        console.log('Clearing active License area...');
                                        activeLicenseAreaRef.current = null;
                                        // Trigger final re-render with normal visibility rules
                                        mapRef.current.fire('moveend');
                                    }
                                }, 800); // Wait a bit longer to ensure user sees the nested elements
                            }
                        });
                    }
                }
            });
        }
    }, [areas, zoom, onEditItem, useEditPanel, disableDefaultPopups, forceUseEditCallback, popupMode]);

    // Handle area corner dragging mode
    useEffect(() => {
        if (!mapRef.current || areaEditMode !== 'corners' || !editingAreaId || !tempAreaPath) return;

        const cornersLayerGroup = L.layerGroup().addTo(mapRef.current);

        // Find the area being edited to get its color
        const editingArea = areas.find(a => a.id === editingAreaId);
        const areaColor = editingArea?.color || '#3b82f6';

        // Render temp area polygon with dashed style
        const areaCoords = tempAreaPath.map(p => [p.lat, p.lng] as [number, number]);
        const tempPolygon = L.polygon(areaCoords, {
            color: areaColor,
            weight: 2,
            fillColor: areaColor,
            fillOpacity: 0.15,
            dashArray: '10, 10'
        }).addTo(cornersLayerGroup);

        // Render draggable corner markers
        tempAreaPath.forEach((corner, index) => {
            const marker = L.marker([corner.lat, corner.lng], {
                icon: createDraggableCornerIcon(index + 1, areaColor),
                draggable: true,
                zIndexOffset: 1000
            }).addTo(cornersLayerGroup);

            // Handle drag event
            marker.on('drag', (e) => {
                const newPosition = e.target.getLatLng();

                // Update temp polygon in real-time
                const newPath = [...tempAreaPath];
                newPath[index] = { lat: newPosition.lat, lng: newPosition.lng };
                const newCoords = newPath.map(p => [p.lat, p.lng] as [number, number]);
                tempPolygon.setLatLngs(newCoords);
            });

            // Handle dragend event
            marker.on('dragend', (e) => {
                const newPosition = e.target.getLatLng();
                onAreaCornerDrag?.(index, newPosition);
            });
        });

        // Cleanup
        return () => {
            cornersLayerGroup.remove();
        };
    }, [areaEditMode, editingAreaId, tempAreaPath, areas, onAreaCornerDrag]);

    // Handle pending pin popup
    useEffect(() => {
        if (pendingPin && mapRef.current && !pinSavingRef.current) {
            console.log('🟡 Showing pin popup at', pendingPin.lat, pendingPin.lng);
            
            const markerIcon = createCustomIcon('#ef4444');
            const tempMarker = L.marker(pendingPin, { icon: markerIcon }).addTo(mapRef.current);
            
            const formId = `pin-form-${Date.now()}`;
            const content = `
                <div style="min-width: 200px; padding: 12px;">
                    <div style="margin-bottom: 8px;">
                        <strong style="font-size: 14px;">Add Pin</strong><br/>
                        <small style="color: #666; font-size: 12px;">
                            Lat: ${pendingPin.lat.toFixed(6)}<br/>
                            Lng: ${pendingPin.lng.toFixed(6)}
                        </small>
                    </div>
                    <form id="${formId}" style="display: flex; flex-direction: column; gap: 8px;">
                        <input type="text" name="label" placeholder="Pin name" required 
                               style="padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; width: 100%;" />
                        <div style="display: flex; justify-content: flex-end; gap: 8px;">
                            <button type="button" class="cancel-btn" 
                                    style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                            <button type="submit" 
                                    style="padding: 4px 8px; font-size: 12px; border-radius: 3px; background: #3b82f6; color: white; border: none; cursor: pointer;">Add Pin</button>
                        </div>
                    </form>
                </div>
            `;

            const popup = L.popup({ closeButton: false, closeOnClick: false })
                .setLatLng(pendingPin)
                .setContent(content)
                .openOn(mapRef.current);

            setTimeout(() => {
                const form = document.getElementById(formId);
                const cancelButton = form?.querySelector('.cancel-btn');

                form?.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    console.log('🎯 PIN FORM SUBMIT: Pin form submitted', {
                        timestamp: Date.now()
                    });
                    
                    // Set saving flag to prevent duplicate popups
                    pinSavingRef.current = true;
                    
                    const formElements = (ev.target as HTMLFormElement).elements;
                    const labelInput = formElements.namedItem('label') as HTMLInputElement;
                    
                    if (!labelInput.value.trim()) {
                        alert('Please enter a label for the pin');
                        pinSavingRef.current = false;
                        return;
                    }
                    
                    const newId = `pin-${Date.now()}`;
                    console.log('🎯 CALLING onPinSave with:', { 
                        id: newId, 
                        label: labelInput.value 
                    });
                    
                    // Call the save handler
                    onPinSave(newId, labelInput.value, pendingPin.lat, pendingPin.lng, ''); // No notes for now
                    
                    // Clean up immediately
                    console.log('🎯 PIN CLEANUP: Removing temp marker and closing popup');
                    tempMarker.remove();
                    mapRef.current?.closePopup();
                    // Close any other popups that might be open
                    mapRef.current?.eachLayer((layer: any) => {
                        if (layer.getPopup && layer.getPopup()) {
                            layer.closePopup();
                        }
                    });
                    
                    // Reset saving flag after a delay to allow state to settle
                    setTimeout(() => {
                        pinSavingRef.current = false;
                    }, 100);
                });

                cancelButton?.addEventListener('click', () => {
                    onPinCancel();
                    tempMarker.remove();
                    mapRef.current?.closePopup();
                });
            }, 0);

            return () => {
                tempMarker.remove();
            };
        }
    }, [pendingPin, onPinSave, onPinCancel]);

    // Handle pending line popup
    useEffect(() => {
        // console.log('🎯 STEP 3: pendingLine useEffect', {
        //     pendingLine: !!pendingLine,
        //     mapRef: !!mapRef.current,
        //     linePopupActive: linePopupActiveRef.current,
        //     lineSaving: lineSavingRef.current,
        //     popupsInDOM: document.querySelectorAll('.leaflet-popup').length,
        //     timestamp: Date.now()
        // });

        if (pendingLine && mapRef.current && !linePopupActiveRef.current && !lineSavingRef.current) {
            // console.log('🎯 STEP 4: Creating line popup');
            linePopupActiveRef.current = true;
            
            const lineCoords = pendingLine.path.map(p => [p.lat, p.lng] as [number, number]);
            const tempLine = L.polyline(lineCoords, { color: '#ef4444', weight: 4 }).addTo(mapRef.current);
            
            const midPoint = L.latLng(
                (pendingLine.path[0].lat + pendingLine.path[1].lat) / 2,
                (pendingLine.path[0].lng + pendingLine.path[1].lng) / 2
            );
            
            const distance = pendingLine.path[0].distanceTo(pendingLine.path[1]);
            const distanceText = distance > 1000 ? `${(distance/1000).toFixed(2)} km` : `${distance.toFixed(0)} m`;
            
            const formId = `line-form-${Date.now()}`;
            const content = `
                <div style="min-width: 250px; padding: 8px;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">Distance: ${distanceText}</p>
                    <form id="${formId}" style="display: flex; flex-direction: column; gap: 8px;">
                        <input type="text" name="label" placeholder="Enter line label" required 
                               style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;" />
                        <textarea name="notes" placeholder="Add notes..." 
                                  style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; min-height: 60px; resize: vertical;"></textarea>
                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                            <button type="button" class="cancel-btn" 
                                    style="padding: 6px 12px; font-size: 12px; border-radius: 4px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                            <button type="submit" 
                                    style="padding: 6px 12px; font-size: 12px; border-radius: 4px; background: #3b82f6; color: white; border: none; cursor: pointer;">Save Line</button>
                        </div>
                    </form>
                </div>
            `;

            console.log('🎯 STEP 5: Opening popup on map');
            const popup = L.popup({ closeButton: false, closeOnClick: false })
                .setLatLng(midPoint)
                .setContent(content)
                .openOn(mapRef.current);
            
            console.log('🎯 STEP 6: Popup opened, DOM elements:', {
                popupsInDOM: document.querySelectorAll('.leaflet-popup').length,
                timestamp: Date.now()
            });

            setTimeout(() => {
                const form = document.getElementById(formId);
                const cancelButton = form?.querySelector('.cancel-btn');

                form?.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    console.log('🎯 FORM SUBMIT: Line form submitted', {
                        timestamp: Date.now()
                    });
                    
                    // Set saving flag to prevent duplicate popups
                    lineSavingRef.current = true;
                    
                    const formElements = (ev.target as HTMLFormElement).elements;
                    const labelInput = formElements.namedItem('label') as HTMLInputElement;
                    const notesInput = formElements.namedItem('notes') as HTMLTextAreaElement;
                    
                    if (!labelInput.value.trim()) {
                        alert('Please enter a label for the line');
                        lineSavingRef.current = false;
                        return;
                    }
                    
                    const newId = `line-${Date.now()}`;
                    console.log('🎯 CALLING onLineSave with:', { 
                        id: newId, 
                        label: labelInput.value, 
                        notes: notesInput.value 
                    });
                    
                    // Call the save handler
                    onLineSave(newId, labelInput.value, pendingLine.path, notesInput.value);
                    
                    // Clean up immediately
                    console.log('🎯 CLEANING UP: Removing temp line and closing popup');
                    tempLine.remove();
                    mapRef.current?.closePopup();
                    // Close any other popups that might be open
                    mapRef.current?.eachLayer((layer: any) => {
                        if (layer.getPopup && layer.getPopup()) {
                            layer.closePopup();
                        }
                    });
                    linePopupActiveRef.current = false;
                    
                    // Reset saving flag after a delay to allow state to settle
                    setTimeout(() => {
                        lineSavingRef.current = false;
                    }, 100);
                });

                cancelButton?.addEventListener('click', () => {
                    onLineCancel();
                    tempLine.remove();
                    mapRef.current?.closePopup();
                    linePopupActiveRef.current = false;
                });
            }, 0);

            return () => {
                console.log('🎯 CLEANUP: Removing line popup and temp line', {
                    timestamp: Date.now()
                });
                tempLine.remove();
                linePopupActiveRef.current = false;
            };
        }
    }, [pendingLine, onLineSave, onLineCancel]);

    // Handle pending area popup
    useEffect(() => {
        if (pendingArea && mapRef.current && !areaSavingRef.current) {
            console.log('Showing area popup');
            
            const areaCoords = pendingArea.path.map(p => [p.lat, p.lng] as [number, number]);
            const tempArea = L.polygon(areaCoords, { 
                color: '#ef4444', 
                weight: 2, 
                fillColor: '#ef4444', 
                fillOpacity: 0.2 
            }).addTo(mapRef.current);
            
            const center = tempArea.getBounds().getCenter();
            
            // Calculate area in hectares
            const areaHectares = calculatePolygonArea(pendingArea.path);
            
            // Generate coordinates list
            const coordsList = pendingArea.path.map((point, index) => 
                `<div style="font-size: 11px; color: #666; margin: 2px 0;">
                    ${index + 1}. Lat: ${point.lat.toFixed(6)}, Lng: ${point.lng.toFixed(6)}
                </div>`
            ).join('');
            
            const formId = `area-form-${Date.now()}`;
            const content = `
                <div style="min-width: 300px; max-width: 400px; padding: 12px;">
                    <div style="margin-bottom: 12px;">
                        <p style="margin: 0 0 4px 0; font-weight: bold; font-size: 14px;">Area Details</p>
                        <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">
                            ${pendingArea.path.length} corners • ${areaHectares.toFixed(2)} hectares
                        </p>
                    </div>
                    
                    <div style="margin-bottom: 12px; max-height: 120px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px; background: #f9fafb;">
                        <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">Coordinates:</div>
                        ${coordsList}
                    </div>
                    
                    <form id="${formId}" style="display: flex; flex-direction: column; gap: 8px;">
                        <input type="text" name="label" placeholder="Enter area label" required 
                               style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;" />
                        <textarea name="notes" placeholder="Add notes..." 
                                  style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; min-height: 60px; resize: vertical;"></textarea>
                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                            <button type="button" class="cancel-btn" 
                                    style="padding: 6px 12px; font-size: 12px; border-radius: 4px; background: #f3f4f6; border: 1px solid #d1d5db; cursor: pointer;">Cancel</button>
                            <button type="submit" 
                                    style="padding: 6px 12px; font-size: 12px; border-radius: 4px; background: #3b82f6; color: white; border: none; cursor: pointer;">Save Area</button>
                        </div>
                    </form>
                </div>
            `;

            const popup = L.popup({ closeButton: false, closeOnClick: false })
                .setLatLng(center)
                .setContent(content)
                .openOn(mapRef.current);

            setTimeout(() => {
                const form = document.getElementById(formId);
                const cancelButton = form?.querySelector('.cancel-btn');

                form?.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    console.log('🎯 AREA FORM SUBMIT: Area form submitted', {
                        timestamp: Date.now()
                    });
                    
                    // Set saving flag to prevent duplicate popups
                    areaSavingRef.current = true;
                    
                    const formElements = (ev.target as HTMLFormElement).elements;
                    const labelInput = formElements.namedItem('label') as HTMLInputElement;
                    const notesInput = formElements.namedItem('notes') as HTMLTextAreaElement;
                    
                    if (!labelInput.value.trim()) {
                        alert('Please enter a label for the area');
                        areaSavingRef.current = false;
                        return;
                    }
                    
                    const newId = `area-${Date.now()}`;
                    console.log('🎯 CALLING onAreaSave with:', { 
                        id: newId, 
                        label: labelInput.value, 
                        notes: notesInput.value 
                    });
                    
                    // Call the save handler
                    onAreaSave(newId, labelInput.value, pendingArea.path, notesInput.value);
                    
                    // Clean up immediately
                    console.log('🎯 AREA CLEANUP: Removing temp area and closing popup');
                    tempArea.remove();
                    mapRef.current?.closePopup();
                    // Close any other popups that might be open
                    mapRef.current?.eachLayer((layer: any) => {
                        if (layer.getPopup && layer.getPopup()) {
                            layer.closePopup();
                        }
                    });
                    
                    // Reset saving flag after a delay to allow state to settle
                    setTimeout(() => {
                        areaSavingRef.current = false;
                    }, 100);
                });

                cancelButton?.addEventListener('click', () => {
                    onAreaCancel();
                    tempArea.remove();
                    mapRef.current?.closePopup();
                });
            }, 0);

            return () => {
                tempArea.remove();
            };
        }
    }, [pendingArea, onAreaSave, onAreaCancel]);

    // Handle live line preview while drawing with distance display
    useEffect(() => {
        if (mapRef.current && isDrawingLine && lineStartPoint && currentMousePosition) {
            
            // Remove existing preview line and distance tooltip
            if (livePreviewLineRef.current) {
                livePreviewLineRef.current.remove();
            }
            if (distanceTooltipRef.current) {
                distanceTooltipRef.current.remove();
            }
            
            // Calculate distance first
            const distance = lineStartPoint.distanceTo(currentMousePosition);
            
            // Only show line and tooltip if there's actual distance (user has moved the map)
            if (distance > 0) {
                // Create new preview line
                const previewPath = [
                    [lineStartPoint.lat, lineStartPoint.lng] as [number, number],
                    [currentMousePosition.lat, currentMousePosition.lng] as [number, number]
                ];
                
                livePreviewLineRef.current = L.polyline(previewPath, {
                    color: '#3b82f6',
                    weight: 3,
                    opacity: 0.7,
                    dashArray: '8, 8'
                }).addTo(mapRef.current);
                
                // Show distance tooltip
                const distanceText = distance > 1000 ? `${(distance/1000).toFixed(2)} km` : `${distance.toFixed(0)} m`;
                
                const midPoint = L.latLng(
                    (lineStartPoint.lat + currentMousePosition.lat) / 2,
                    (lineStartPoint.lng + currentMousePosition.lng) / 2
                );
                
                // Create distance tooltip
                distanceTooltipRef.current = L.tooltip({
                    permanent: true,
                    direction: 'center',
                    className: 'distance-tooltip-minimal'
                })
                .setContent(distanceText)
                .setLatLng(midPoint)
                .addTo(mapRef.current);
            }
            
        } else if (livePreviewLineRef.current || distanceTooltipRef.current) {
            // Remove preview line and distance tooltip when not drawing
            if (livePreviewLineRef.current) {
                livePreviewLineRef.current.remove();
                livePreviewLineRef.current = null;
            }
            if (distanceTooltipRef.current) {
                distanceTooltipRef.current.remove();
                distanceTooltipRef.current = null;
            }
        }
        
        // Cleanup on unmount or when drawing stops
        return () => {
            if (livePreviewLineRef.current) {
                livePreviewLineRef.current.remove();
                livePreviewLineRef.current = null;
            }
            if (distanceTooltipRef.current) {
                distanceTooltipRef.current.remove();
                distanceTooltipRef.current = null;
            }
        };
    }, [isDrawingLine, lineStartPoint, currentMousePosition]);

    // Handle live area preview while drawing
    useEffect(() => {
        if (mapRef.current && isDrawingArea && areaStartPoint && currentAreaEndPoint) {
            
            // Remove existing preview line and distance tooltip
            if (liveAreaPreviewRef.current) {
                liveAreaPreviewRef.current.remove();
            }
            if (areaDistanceTooltipRef.current) {
                areaDistanceTooltipRef.current.remove();
            }
            
            // Calculate distance first
            const distance = areaStartPoint.distanceTo(currentAreaEndPoint);
            
            // Only show line and tooltip if there's actual distance (user has moved the map)
            if (distance > 0) {
                // Create preview line from start to current end point
                const previewPath = [
                    [areaStartPoint.lat, areaStartPoint.lng] as [number, number],
                    [currentAreaEndPoint.lat, currentAreaEndPoint.lng] as [number, number]
                ];
                
                liveAreaPreviewRef.current = L.polyline(previewPath, {
                    color: '#3b82f6',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '8, 8'
                }).addTo(mapRef.current);
                
                // Show distance tooltip
                const distanceText = distance > 1000 ? `${(distance/1000).toFixed(2)} km` : `${distance.toFixed(0)} m`;
                
                const midPoint = L.latLng(
                    (areaStartPoint.lat + currentAreaEndPoint.lat) / 2,
                    (areaStartPoint.lng + currentAreaEndPoint.lng) / 2
                );
                
                // Create distance tooltip
                areaDistanceTooltipRef.current = L.tooltip({
                    permanent: true,
                    direction: 'center',
                    className: 'distance-tooltip-minimal area'
                })
                .setContent(distanceText)
                .setLatLng(midPoint)
                .addTo(mapRef.current);
            }
            
        } else if (liveAreaPreviewRef.current || areaDistanceTooltipRef.current) {
            // Remove preview line and distance tooltip when not drawing
            if (liveAreaPreviewRef.current) {
                liveAreaPreviewRef.current.remove();
                liveAreaPreviewRef.current = null;
            }
            if (areaDistanceTooltipRef.current) {
                areaDistanceTooltipRef.current.remove();
                areaDistanceTooltipRef.current = null;
            }
        }
        
        // Cleanup on unmount or when drawing stops
        return () => {
            if (liveAreaPreviewRef.current) {
                liveAreaPreviewRef.current.remove();
                liveAreaPreviewRef.current = null;
            }
            if (areaDistanceTooltipRef.current) {
                areaDistanceTooltipRef.current.remove();
                areaDistanceTooltipRef.current = null;
            }
        };
    }, [isDrawingArea, areaStartPoint, currentAreaEndPoint]);

    // Render area preview path
    useEffect(() => {
        if (mapRef.current && pendingAreaPath.length > 1) {
            // Remove existing preview area and filled area
            if (previewAreaLineRef.current) {
                previewAreaLineRef.current.remove();
            }
            if (previewAreaRef.current) {
                previewAreaRef.current.remove();
            }
            
            const areaCoords = pendingAreaPath.map(p => [p.lat, p.lng] as [number, number]);
            
            // If we have 3+ points, show filled polygon area
            if (pendingAreaPath.length >= 3) {
                previewAreaRef.current = L.polygon(areaCoords, {
                    color: '#3b82f6',
                    weight: 4,
                    opacity: 0.8,
                    fillColor: '#3b82f6',
                    fillOpacity: 0.2
                }).addTo(mapRef.current);
            } else {
                // For 2 points, just show the line
                previewAreaLineRef.current = L.polyline(areaCoords, {
                    color: '#3b82f6',
                    weight: 4,
                    opacity: 0.8
                }).addTo(mapRef.current);
            }
            
        } else if (previewAreaLineRef.current || previewAreaRef.current) {
            if (previewAreaLineRef.current) {
                previewAreaLineRef.current.remove();
                previewAreaLineRef.current = null;
            }
            if (previewAreaRef.current) {
                previewAreaRef.current.remove();
                previewAreaRef.current = null;
            }
        }
        
        return () => {
            if (previewAreaLineRef.current) {
                previewAreaLineRef.current.remove();
                previewAreaLineRef.current = null;
            }
            if (previewAreaRef.current) {
                previewAreaRef.current.remove();
                previewAreaRef.current = null;
            }
        };
    }, [pendingAreaPath]);

    return <div ref={mapContainerRef} className="h-full w-full z-0 min-h-[500px]" style={{ height: '100%', minHeight: '500px' }} />;
};

// Custom comparison function for React.memo()
// Only re-render if critical props that affect map rendering change
const arePropsEqual = (prevProps: LeafletMapProps, nextProps: LeafletMapProps): boolean => {
    // Check map position props
    const centerEqual =
        Array.isArray(prevProps.center) && Array.isArray(nextProps.center)
            ? prevProps.center[0] === nextProps.center[0] && prevProps.center[1] === nextProps.center[1]
            : prevProps.center === nextProps.center;

    if (!centerEqual || prevProps.zoom !== nextProps.zoom) {
        return false;
    }

    // Check data arrays (reference equality - they should be memoized in parent)
    if (prevProps.pins !== nextProps.pins ||
        prevProps.lines !== nextProps.lines ||
        prevProps.areas !== nextProps.areas) {
        return false;
    }

    // Check drawing state
    if (prevProps.isDrawingLine !== nextProps.isDrawingLine ||
        prevProps.isDrawingArea !== nextProps.isDrawingArea ||
        prevProps.lineStartPoint !== nextProps.lineStartPoint ||
        prevProps.areaStartPoint !== nextProps.areaStartPoint ||
        prevProps.currentMousePosition !== nextProps.currentMousePosition ||
        prevProps.currentAreaEndPoint !== nextProps.currentAreaEndPoint) {
        return false;
    }

    // Check pending items
    if (prevProps.pendingPin !== nextProps.pendingPin ||
        prevProps.pendingLine !== nextProps.pendingLine ||
        prevProps.pendingArea !== nextProps.pendingArea ||
        prevProps.pendingAreaPath !== nextProps.pendingAreaPath) {
        return false;
    }

    // Check editing state
    if (prevProps.editingGeometry !== nextProps.editingGeometry ||
        prevProps.itemToEdit !== nextProps.itemToEdit ||
        prevProps.lineEditMode !== nextProps.lineEditMode ||
        prevProps.editingLineId !== nextProps.editingLineId ||
        prevProps.tempLinePath !== nextProps.tempLinePath ||
        prevProps.areaEditMode !== nextProps.areaEditMode ||
        prevProps.editingAreaId !== nextProps.editingAreaId ||
        prevProps.tempAreaPath !== nextProps.tempAreaPath) {
        return false;
    }

    // Check visibility and UI props
    if (prevProps.projectVisibility !== nextProps.projectVisibility ||
        prevProps.activeProjectId !== nextProps.activeProjectId ||
        prevProps.showPopups !== nextProps.showPopups ||
        prevProps.useEditPanel !== nextProps.useEditPanel ||
        prevProps.disableDefaultPopups !== nextProps.disableDefaultPopups ||
        prevProps.popupMode !== nextProps.popupMode) {
        return false;
    }

    // Check settings
    if (prevProps.settings !== nextProps.settings) {
        return false;
    }

    // Check current location
    if (prevProps.currentLocation !== nextProps.currentLocation) {
        return false;
    }

    // For callbacks, we assume they are memoized in the parent component
    // If they're not, they'll cause re-renders, which is expected behavior

    return true; // Props are equal, skip re-render
};

// Export memoized component for better performance
export default memo(LeafletMap, arePropsEqual);