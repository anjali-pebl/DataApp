# Category-Based File Organization Implementation

**Date:** January 6, 2026
**Status:** ✅ Implemented

## Overview

Replaced the suffix-based file organization system with a category-based system that uses pattern matching to categorize files into tiles and optional subcategories.

## Changes Made

### 1. Configuration Module (`src/lib/file-categorization-config.ts`)

Created a centralized configuration file that defines:
- File categorization rules based on filename patterns
- Tile structure and naming
- Category definitions for each tile
- Helper functions for categorization

**Key Features:**
- **Pattern Matching:** Files are matched using `contains` strings (case-insensitive)
- **Multiple Categorizations:** A file can match multiple patterns and appear in multiple tiles
- **Optional Categories:** Some tiles have categories, others don't
- **Type-Safe:** Full TypeScript support with exported types

**Example Rules:**
```typescript
{
  contains: 'EDNAS',
  tile: 'eDNA',
  category: 'Sediment',
}
```

### 2. Tile Structure

**Tiles (in display order):**
1. **SubCam** - Files containing "SUBCAM" (no categories)
2. **GrowProbe** - Files containing "GP" (no categories)
3. **FPOD** - Files containing "FPOD" (no categories) + Files with "24hr" have category "Avg 24hrs"
4. **Water and Crop Samples** - Categories:
   - Crop Chem (CHEMSW)
   - Water Chem (CHEMWQ)
   - Crop Growth (Crop)
5. **eDNA** - Categories:
   - Sediment (EDNAS)
   - Water (EDNAW)
   - Haplotypes (Hapl)
   - Taxonomy (Taxo)
   - Credibility Score (Cred)
   - Metadata (Meta)

### 3. ProjectDataDialog Updates (`src/components/map-drawing/dialogs/ProjectDataDialog.tsx`)

**SourceTile Component Changes:**
- Removed `extractSuffix()` and `getWaterSampleCategory()` functions
- Added `getFileCategory()` using `categorizeFile()` from config
- Replaced `selectedSuffixes` state with `selectedCategories`
- Updated filtering logic to use categories from config
- Changed dropdown label from "Suffixes" to "Categories"
- Only shows category filter if tile has categories defined

**Main Dialog Changes:**
- Removed `getFileSource()` function (pattern matching logic)
- Updated `groupFilesBySource()` to use `categorizeFile()` from config
- Supports multiple tile assignments per file
- Removed hardcoded `sourceLabels` mapping
- Updated tile rendering to use `TILE_NAMES` from config
- Simplified tile key and label to use single `tileName` value

### 4. File Categorization Logic

**Before:**
```typescript
// Hardcoded logic scattered throughout component
const getFileSource = (file: any): string => {
  const parts = file.fileName.split('_');
  const position0 = parts[0]?.toLowerCase() || '';
  // ... complex if/else chains
};
```

**After:**
```typescript
// Centralized configuration-based approach
import { categorizeFile } from '@/lib/file-categorization-config';

const matches = categorizeFile(file.fileName);
// Returns: [{ tile: 'eDNA', category: 'Sediment' }]
```

## Benefits

1. **Maintainability:** All categorization rules in one config file
2. **Flexibility:** Easy to add new tiles, categories, or patterns
3. **Consistency:** Same logic used throughout the application
4. **Type Safety:** Full TypeScript support with exported types
5. **Multiple Categorizations:** Files can appear in multiple tiles if needed
6. **User Experience:** Clear category labels instead of technical suffixes

## Testing

The implementation should be tested with:
1. Files from each tile category
2. Files that match multiple patterns
3. Category filtering within each tile
4. Edge cases (no category, unknown patterns)

## File Mapping Reference

Based on `ODP Filetypes and Categories.xlsx`:

| Contains | Tile                    | Category           |
|----------|-------------------------|--------------------|
| SUBCAM   | SubCam                  | -                  |
| GP       | GrowProbe               | -                  |
| FPOD     | FPOD                    | -                  |
| 24hr     | FPOD                    | Avg 24hrs          |
| CHEMSW   | Water and Crop Samples  | Crop Chem          |
| CHEMWQ   | Water and Crop Samples  | Water Chem         |
| Crop     | Water and Crop Samples  | Crop Growth        |
| EDNAS    | eDNA                    | Sediment           |
| EDNAW    | eDNA                    | Water              |
| Hapl     | eDNA                    | Haplotypes         |
| Taxo     | eDNA                    | Taxonomy           |
| Cred     | eDNA                    | Credibility Score  |
| Meta     | eDNA                    | Metadata           |

## Future Enhancements

Possible improvements:
- Add user-configurable categorization rules via UI
- Support regex patterns for more complex matching
- Add file count badges per category
- Implement drag-and-drop between categories
- Add bulk recategorization tools
- Export/import category configurations
