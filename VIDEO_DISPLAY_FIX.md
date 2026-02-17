# Video Display Fix - Videos Disappearing After Processing

**Date:** 2025-11-27
**Status:** ✅ FIXED
**Priority:** HIGH

---

## Problem

After video processing completed successfully, videos disappeared from the table. The logs showed:
```
📊 Loaded 5 videos (5 processed, 0 pending)
```

But the table was empty.

---

## Root Cause

The unified pipeline saves JSON with this structure:
```json
{
  "video_info": { "filename": "...", "fps": 24, ... },
  "motion_analysis": {
    "activity_score": { ... },
    "motion": { ... },
    "density": { ... },
    "organisms": { ... }
  }
}
```

But the dashboard component (`MotionAnalysisDashboard.tsx`) expects a flat structure:
```json
{
  "video_info": { "filename": "...", "fps": 24, ... },
  "activity_score": { ... },
  "motion": { ... },
  "density": { ... },
  "organisms": { ... }
}
```

The dashboard's `validData` filter (line 666) checks:
```typescript
if (v?.activity_score?.overall_score === undefined || !v?.video_info?.filename) {
  return false; // Filter out invalid videos
}
```

The page was only spreading `v.motion_analysis`:
```typescript
data={processedVideos.map(v => ({
  ...v.motion_analysis,  // Missing video_info!
  processing_history: v.processing_history || [],
}))}
```

This resulted in:
- ✅ `activity_score` present (from motion_analysis)
- ❌ `video_info` missing (was at root level, not spread)
- ❌ Videos filtered out by validData filter
- ❌ Empty table

---

## Solution

**File:** `src/app/motion-analysis/page.tsx` (Lines 389-406)

Changed from:
```typescript
data={processedVideos.map(v => ({
  ...v.motion_analysis,
  processing_history: v.processing_history || [],
}))}
```

To:
```typescript
data={processedVideos.map(v => {
  const motionData = v.motion_analysis || {};
  return {
    // Extract root-level fields
    video_info: motionData.video_info,
    // Extract nested motion_analysis fields
    activity_score: motionData.motion_analysis?.activity_score || motionData.activity_score,
    motion: motionData.motion_analysis?.motion || motionData.motion,
    density: motionData.motion_analysis?.density || motionData.density,
    organisms: motionData.motion_analysis?.organisms || motionData.organisms,
    processing_time_seconds: motionData.processing_time_seconds || motionData.motion_analysis?.processing_time_seconds,
    timestamp: motionData.timestamp || new Date().toISOString(),
    processing_history: v.processing_history || [],
  };
})}
```

This handles both:
1. **Unified pipeline format** (nested motion_analysis)
2. **Legacy format** (flat structure)

---

## Testing

After the fix:
- ✅ Videos appear in table immediately after processing
- ✅ Score, activity timeline, density, and YOLO detections all display correctly
- ✅ Processing history accessible via History button
- ✅ No filtering of valid processed videos

---

## Prevention

When adding new JSON structures:
1. **Document the structure** in code comments
2. **Test the dashboard display** after processing completes
3. **Check validData filter requirements** in MotionAnalysisDashboard.tsx
4. **Ensure all required fields** are present at the correct nesting level

---

## Related Issues Fixed

This fix also resolves:
- Processed videos not showing in summary statistics
- Charts not updating after processing completes
- "No videos processed yet" message despite successful processing

---

## Files Modified

1. `src/app/motion-analysis/page.tsx` (Lines 389-406)
   - Updated data mapping to extract both root-level and nested fields
   - Added fallback logic for legacy format compatibility

---

## Impact

- ✅ Videos display immediately after processing
- ✅ All dashboard features work correctly
- ✅ No user action required to "refresh" or "reload"
- ✅ Compatible with both unified pipeline and legacy formats
