# Merged Files Location Pin Assignment Fix

**Date:** January 6, 2026
**Status:** ✅ Implemented

## Overview

Fixed merged files to display their actual location pin labels instead of generic "Merged Files" or "Unassigned" labels throughout the application.

## Problem

Previously, merged files were hardcoded to use:
- `pinId: 'merged'` (instead of actual pin ID from database)
- `pinLabel: 'Merged Files'` (instead of actual pin name)

This caused merged FPOD files to display as:
- ❌ `Unassigned • Jan 1 - Dec 31 (24hr)` or
- ❌ `Multiple Locations • Jan 1 - Dec 31 (24hr)`

Instead of showing the actual location like:
- ✅ `Control_S • Jan 1 - Dec 31 (24hr)`
- ✅ `Farm_AS • Jan 1 - Dec 31 (24hr)`

## Database Structure

Merged files in the database already had the correct structure:
- `pin_id` column - Links to actual pin location
- Files stored at: `{pinId}/merged/{filename}` in storage
- Every merged file is associated with a specific pin

The issue was **frontend display logic**, not the database.

## Changes Made

### 1. **map-drawing/page.tsx** - Three locations updated:

#### Location 1: `getProjectFiles()` function (lines 636-656)
```typescript
// BEFORE
pinId: 'merged',
pinLabel: 'Merged Files',

// AFTER
const pin = pins.find(p => p.id === mergedFile.pinId);
const pinLabel = pin?.label || 'Unknown Pin';
pinId: mergedFile.pinId, // Use actual pinId
pinLabel: pinLabel, // Use actual pin label
```

#### Location 2: `loadMergedFiles()` function (lines 1550-1570)
```typescript
// BEFORE
pinLabel: 'Merged' // Generic label

// AFTER
const pin = pins.find(p => p.id === mf.pinId);
const pinLabel = pin?.label || 'Unknown Pin';
pinLabel: pinLabel // Actual pin label from lookup
```

#### Location 3: `availableFilesForPlots` memo (lines 578-604)
```typescript
// BEFORE
pinId: 'merged',
pinName: 'Merged Files',
pinLocation: undefined,

// AFTER
const pin = pins.find(p => p.id === mergedFile.pinId);
const pinName = pin?.label || 'Unknown Pin';
const pinLocation = pin ? { lat: pin.lat, lng: pin.lng } : undefined;
pinId: mergedFile.pinId,
pinName: pinName,
pinLocation: pinLocation,
```

#### Location 4: `handleDownloadFileForPlot()` function (lines 4421-4464)
```typescript
// BEFORE
if (pinId === 'merged') { ... }
setPinFiles(prev => ({ ...prev, [pinId]: [...] }))

// AFTER
const mergedFileMetadata = mergedFiles.find(f => f.fileName === fileName);
const isMergedFile = !!mergedFileMetadata || providedMetadata?.fileSource === 'merged';
if (isMergedFile) { ... }
setPinFiles(prev => ({ ...prev, [actualPinId]: [...] }))
```

### 2. **DataTimeline.tsx** - Display logic updated:

#### `getTimelineDisplayName()` function (lines 1062-1077)
```typescript
// BEFORE
const location = extractLocationFromMergedFile(file.fileName);
const locationLabel = location || 'Unassigned';

// AFTER
let locationLabel = file.pinLabel; // Try actual pin label first

// Fallback to filename extraction if pin label is generic
if (!locationLabel || locationLabel === 'Unknown Pin' ||
    locationLabel === 'Merged Files' || locationLabel === 'Merged') {
  const extractedLocation = extractLocationFromMergedFile(file.fileName);
  locationLabel = extractedLocation || 'Unassigned';
}
```

### 3. **data-explorer/page.tsx** - Pin lookup logic updated:

#### `handleFileClick()` function (line 504-506)
```typescript
// BEFORE
if (file.pinId && file.pinId !== 'merged') {

// AFTER
if (file.pinId) { // Now works for merged files since they have actual pinIds
```

## Display Logic Hierarchy

For merged files, the system now uses this hierarchy to determine the location label:

1. **Primary:** Actual pin label from `pins` array lookup
2. **Fallback 1:** Extract station code from filename (e.g., "C_S", "F_AS")
3. **Fallback 2:** Show "Unassigned"

## File Naming Examples

### Multi-part Station Codes
The filename extraction supports multi-part station codes:

| Filename | Station Extracted | Pin Label | Display |
|----------|------------------|-----------|---------|
| `Control_FPOD_C_S_merge_2024.csv` | C_S | Control_S | **Control_S** • 2024 (24hr) |
| `Farm_FPOD_F_AS_merge_2024.csv` | F_AS | Farm_AS | **Farm_AS** • 2024 (24hr) |
| `Control_FPOD_C_W_2024.csv` | C_W | Control_W | **Control_W** • 2024 |
| `Farm_FPOD_F_L_2024.csv` | F_L | Farm_L | **Farm_L** • 2024 |
| `Project_FPOD_merge_2024.csv` | *(none)* | Unknown Pin | **Unassigned** • 2024 |

### Location Pin Mappings
Based on your chart:
- **C_S** → Control_S pin
- **C_W** → Control_W pin
- **F_AS** → Farm_AS pin
- **F_L** → Farm_L pin

## Benefits

1. **Accurate Location Display:** Merged files now show their actual location
2. **Consistent with Database:** Frontend matches database structure
3. **Better User Experience:** Users can identify file locations at a glance
4. **Proper Grouping:** Files group correctly by location pin
5. **Map Integration:** Merged files now link to correct map pins with lat/lng

## Testing

To verify the fix works:

1. Create a merged file from multiple FPOD files at a specific location pin
2. Check the Project Data files page - merged file should show the pin name
3. Check the timeline view - should display actual location (e.g., "Control_S")
4. Verify file can be plotted and downloads correctly
5. Confirm merged file appears in correct tile category

## Impact

- **All merged files** now display with actual location pins
- **FPOD merged files** specifically benefit from station code extraction
- **Other file types** (GP, SubCam, eDNA, etc.) also use actual pin labels
- **No database changes** required - fix is frontend only

## Future Enhancements

Possible improvements:
- Add bulk reassignment UI for merged files with "Unknown Pin"
- Show pin location coordinates in merged file metadata
- Add validation to prevent creating merged files without valid pinId
- Display source file locations in merged file tooltip
