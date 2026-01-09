# Data Visualization Header Update

**Date:** January 6, 2026
**Status:** ✅ Implemented

## Overview

Updated the data visualization popup header to display meaningful metadata instead of just the raw filename. The header now shows:
1. **Location name** (pin label)
2. **Time period** (start date - end date)
3. **Category badge** (if applicable - e.g., "24hr", "Haplotypes", "Sediment")
4. **Raw filename** below in smaller monospace font

## Changes Made

### 1. **PinChartDisplay.tsx** - Display Component

**Lines 41-52:** Added new props to interface
```typescript
interface PinChartDisplayProps {
  // ... existing props
  // File metadata for header display
  pinLabel?: string; // Location name (e.g., "Control_S", "Farm_AS")
  startDate?: Date; // Start date of data
  endDate?: Date; // End date of data
  fileCategory?: string; // Category (e.g., "24hr", "Haplotypes", "Sediment")
}
```

**Lines 382-393:** Updated function signature to destructure new props

**Lines 2948-2990:** Updated header display JSX
```tsx
<div className="flex flex-col gap-0.5">
  {/* Main header: Location • Time Period (Category) */}
  {(pinLabel || startDate || endDate || fileCategory) && (
    <div className="text-sm font-semibold text-foreground flex items-center gap-2">
      {/* Location */}
      {pinLabel && <span>{pinLabel}</span>}

      {/* Time Period */}
      {(startDate || endDate) && (
        <>
          {pinLabel && <span className="text-muted-foreground">•</span>}
          <span className="font-normal">
            {startDate && endDate
              ? `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`
              : ...
            }
          </span>
        </>
      )}

      {/* Category badge */}
      {fileCategory && (
        <span className="text-xs px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
          {fileCategory}
        </span>
      )}
    </div>
  )}

  {/* Raw filename in smaller font */}
  {fileName && (
    <div className="text-xs text-muted-foreground font-mono">
      {fileName}
    </div>
  )}
</div>
```

### 2. **PinPlotInstance.tsx** - Plot Instance Component

**Lines 39-43:** Added new props to interface
```typescript
interface PinPlotInstanceProps {
  // ... existing props
  // File metadata for header display
  pinLabel?: string; // Location name
  startDate?: Date; // Start date of data
  endDate?: Date; // End date of data
  fileCategory?: string; // Category (e.g., "24hr", "Haplotypes")
}
```

**Lines 88-91:** Updated function signature to accept new props

**Lines 306-309:** Pass props to PinChartDisplay
```typescript
<PinChartDisplay
  // ... existing props
  pinLabel={pinLabel}
  startDate={startDate}
  endDate={endDate}
  fileCategory={fileCategory}
  // ... more props
/>
```

### 3. **PinMarineDeviceData.tsx** - Parent Component

**Lines 73-77:** Added metadata fields to PlotConfig interface
```typescript
interface PlotConfig {
  // ... existing fields
  // File metadata for header display
  pinLabel?: string;
  startDate?: Date;
  endDate?: Date;
  fileCategory?: string;
}
```

**Lines 1277-1280:** Updated addPlot options parameter
```typescript
options?: {
  // ... existing options
  pinLabel?: string;
  startDate?: Date;
  endDate?: Date;
  fileCategory?: string;
}
```

**Lines 1295-1298:** Added metadata to plot object creation
```typescript
{
  // ... existing fields
  pinLabel: options?.pinLabel,
  startDate: options?.startDate,
  endDate: options?.endDate,
  fileCategory: options?.fileCategory,
}
```

**Lines 2614-2617:** Pass metadata to PinPlotInstance
```typescript
<PinPlotInstance
  // ... existing props
  pinLabel={plot.pinLabel}
  startDate={plot.startDate}
  endDate={plot.endDate}
  fileCategory={plot.fileCategory}
  // ... more props
/>
```

**Lines 2778-2798 & 2812-2832:** Extract and pass metadata when adding plots
```typescript
// Extract metadata for header display
const metadata = fileOption.metadata;
const pinLabel = (metadata as any)?.pinLabel || fileOption.pinName;
const startDate = metadata?.startDate;
const endDate = metadata?.endDate;

// Extract category from filename using categorization
const { categorizeFile } = await import('@/lib/file-categorization-config');
const categories = categorizeFile(fileOption.fileName);
const fileCategory = categories[0]?.category;

addPlot('device', [downloadedFile], {
  // ... existing options
  pinLabel,
  startDate,
  endDate,
  fileCategory
});
```

## Example Displays

### Before:
```
Control_FPOD_C_S_24hr.csv
```

### After:
```
Control_S • Jan 15, 2024 - Mar 20, 2024  [24hr]
Control_FPOD_C_S_24hr.csv
```

### Example with eDNA Haplotype File:
```
Farm_AS • Apr 1, 2024 - Jun 30, 2024  [Haplotypes]
Farm_EDNAS_F_AS_Hapl.csv
```

### Example without Category:
```
Control_W • May 10, 2024 - Aug 15, 2024
Control_GP_C_W_2024.csv
```

## Header Layout

**Structure:**
```
┌─────────────────────────────────────────────────────────┐
│ Location • Time Period              [Category Badge]    │
│ raw_filename.csv                                        │
└─────────────────────────────────────────────────────────┘
```

**Styling:**
- **Location:** `text-sm font-semibold` (larger, bold)
- **Time Period:** `text-sm font-normal` (larger, regular weight)
- **Category Badge:** `text-xs px-2 py-0.5 rounded-md` amber background
- **Separator:** `•` bullet in muted color
- **Filename:** `text-xs font-mono text-muted-foreground` (smaller, monospace, muted)

## Data Flow

1. **User clicks file in timeline** → Opens data visualization popup
2. **File selection includes metadata:**
   - `pinLabel` from database pin lookup or filename extraction
   - `startDate` and `endDate` from file metadata
   - `fileCategory` from file categorization rules
3. **Metadata flows through component tree:**
   - PinMarineDeviceData (extracts from fileOption)
   - → PinPlotInstance (passes through)
   - → PinChartDisplay (displays in header)

## Category Extraction

Uses the new file categorization system:
```typescript
import { categorizeFile } from '@/lib/file-categorization-config';
const categories = categorizeFile(fileName);
const fileCategory = categories[0]?.category;
```

**Categories mapped:**
- **FPOD:** "Avg 24hrs" (for 24hr files)
- **eDNA:** "Sediment", "Water", "Haplotypes", "Taxonomy", "Credibility Score", "Metadata"
- **Water/Crop:** "Crop Chem", "Water Chem", "Crop Growth"
- **Others:** No category (undefined)

## Benefits

✅ **Immediate Context:** Users see location and time period at a glance
✅ **Category Clarity:** Visual badge makes category obvious
✅ **Clean Hierarchy:** Important info prominent, filename details below
✅ **Accessibility:** Larger text for main information
✅ **Professional:** Matches industry-standard data visualization headers
✅ **Works with Merged Files:** Shows actual pin location from database

## Testing

To verify:
1. Open any data file from the timeline
2. Check header shows:
   - Location name (not "Unknown Pin" or "Unassigned")
   - Date range if available
   - Category badge if file has one (e.g., FPOD 24hr, eDNA Hapl files)
   - Raw filename below in smaller gray text
3. Test with:
   - Regular files (with pin assignment)
   - Merged files (should show actual pin label)
   - Files with categories (FPOD 24hr, eDNA files)
   - Files without categories (GP, SubCam)

## Future Enhancements

Possible improvements:
- Add file size indicator
- Show number of parameters/columns
- Add data quality indicator (% completeness)
- Make header collapsible for more screen space
- Add quick-edit for location assignment
- Show sampling frequency/interval
