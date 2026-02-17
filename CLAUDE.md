# CLAUDE.md - Task Tracker & Guidelines

## Guidelines for Claude

### Playwright MCP - Efficient Usage (NEW - 2025-01-23)

**IMPORTANT:** Playwright MCP responses can consume 10k+ tokens per snapshot. Follow these efficient patterns to reduce context usage by **80-95%**.

**Quick Reference:**
- ✅ **DO**: Use `browser_console_messages` for error checking (200 tokens)
- ✅ **DO**: Use `browser_evaluate` for DOM queries (100-200 tokens)
- ✅ **DO**: Use `browser_network_requests` for API verification (300 tokens)
- ❌ **DON'T**: Use `browser_snapshot` after every action (11k tokens each)
- ❌ **DON'T**: Take full-page screenshots for simple checks (2-4k tokens)

**Detailed Guide:** See `.claude/skills/playwright-efficient.md` for complete patterns and examples.

**Token Usage Comparison:**
```
Inefficient approach: browser_snapshot × 4 = ~44k tokens
Efficient approach:   browser_evaluate + console = ~500 tokens
Savings: 97% reduction
```

---

### Development Server
**IMPORTANT:** This application runs on **localhost:9002** (not localhost:3000). When using Playwright MCP or navigating to the application, always use `http://localhost:9002`.

---

### SQL Queries
**IMPORTANT:** When providing SQL queries to run in Supabase, provide ONLY the raw SQL without comments. The SQL should be ready to copy and paste directly into the Supabase SQL Editor without any modifications.

❌ **Don't do this:**
```sql
-- This adds a color column
ALTER TABLE areas ADD COLUMN color TEXT;
```

✅ **Do this:**
```sql
ALTER TABLE areas ADD COLUMN color TEXT;
```

---

### Motion Analysis Processing Rules
**CRITICAL RULE:** The processing system must ONLY run the analysis jobs that the user has explicitly selected in the settings panel.

**Implementation:**
- UI checkboxes control which jobs run:
  - "Benthic Activity Detection" → `enableBenthicActivityV4`
  - "YOLO Detection" → `enableYolo`
- Settings are passed from `ProcessingEstimationModal.tsx` → API route → Python batch script
- Python script checks `settings.get('enableBenthicActivityV4')` and `settings.get('enableYolo')` before running each job
- If a checkbox is unchecked, that analysis type MUST NOT run

**Files:**
- Frontend: `src/components/motion-analysis/ProcessingEstimationModal.tsx:449-472`
- API: `src/app/api/motion-analysis/process/start/route.ts:38-65`
- Python: `cv_scripts/batch_process_videos.py:492, 529`

**Validation:**
- At least one analysis type must be selected to enable processing
- Processing button is disabled if both checkboxes are unchecked
- Error message: "Select at least one analysis type"

---

## Active Projects

### 🌊 Underwater Video CV/ML Platform (NEW - 2025-01-21)

**Status:** Planning & Setup Phase
**Full Documentation:** [UNDERWATER_CV_ML_PLATFORM.md](./UNDERWATER_CV_ML_PLATFORM.md)

**Quick Summary:**
Notebook-style experimentation platform for processing HD 1080p underwater videos to detect and classify marine organisms (fish, snails, crabs, shellfish) using computer vision and machine learning.

**Architecture:**
- **Layer 1:** Jupyter Notebooks (Local PC) - Experimentation, preprocessing, visualization
- **Layer 2:** Modal.com (Cloud GPU) - Model training, heavy inference, parallel experiments
- **Layer 3:** Supabase + Next.js - Experiment tracking, results dashboard, model registry

**Technology Stack:**
- Local: Jupyter Lab, Python 3.11, OpenCV, PyTorch, Ultralytics YOLO
- Cloud: Modal.com (T4 GPU, pay-per-second billing)
- Tracking: PostgreSQL (Supabase), Next.js dashboard

**Cost Estimate:** $15-30/month (pay only for GPU usage)

**Next Steps:**
1. Set up local Jupyter environment
2. Create Modal account and test GPU access
3. Implement experiment tracking database schema
4. Build web dashboard for experiment visualization
5. Begin underwater video preprocessing experiments

**Related Files:**
- Project spec: `UNDERWATER_CV_ML_PLATFORM.md`
- Notebooks (to be created): `ocean-ml-notebooks/`
- Dashboard (to be created): `src/app/cv-experiments/`
- Database migration (to be created): `supabase/migrations/YYYYMMDD_cv_experiments.sql`

---

## Task 1: TODO Implementation Details

### TODO #1: File Opening Functionality
**Location:** `src/app/data-explorer/page.tsx:203-210`

**Current State:**
- Shows toast notification: "Opening {fileName}... (Feature coming soon)"
- File details available via `UserFileDetails` interface
- FileActionsDialog already handles rename/delete operations

**Required Implementation:**
1. **File Preview Component**
   - Create `FilePreviewDialog.tsx` in `src/components/data-explorer/`
   - Support CSV file preview with data table
   - Show file metadata (size, upload date, date range)
   - Add column header detection and data type inference

2. **File Download Functionality**
   - Add download button to preview dialog
   - Use Supabase Storage download API from `file-storage-service.ts`
   - Handle file blob conversion and browser download

3. **File Data Visualization** (Optional Enhancement)
   - Quick plot preview for numerical columns
   - Date range visualization
   - Data quality summary (null counts, data types)

4. **Integration Steps**
   - Modify `handleOpenFile()` callback in data-explorer/page.tsx
   - Add file preview dialog state management
   - Pass file details to preview component
   - Add error handling for file download failures

**API Requirements:**
- File download: `fileStorageService.downloadFile(filePath)`
- File content parsing: CSV parser (papa-parse or similar)
- Storage path format: Already available in `UserFileDetails.filePath`

**Estimated Complexity:** Medium (2-3 hours)

---

### TODO #2: Email Service Integration
**Location:** `src/lib/supabase/user-validation-service.ts:290`

**Current State:**
- Placeholder function `sendInvitationEmail()` that only logs
- Used for pin sharing invitations
- Receives: inviteeEmail, inviterName, pinName, invitationLink

**Required Implementation:**
1. **Email Service Provider Setup** (Choose One)
   - **Resend** (Recommended - simple, modern, good free tier)
   - **SendGrid** (Enterprise-grade, complex pricing)
   - **AWS SES** (Cheap but requires AWS setup)
   - **Nodemailer** (Self-hosted SMTP)

2. **Environment Configuration**
   - Add to `.env.local`:
     ```
     RESEND_API_KEY=re_xxxxxxxxxxxxx
     EMAIL_FROM_ADDRESS=noreply@yourdomain.com
     EMAIL_FROM_NAME=PEBL Pin Sharing
     ```

3. **Email Template Design**
   - Create HTML email template in `src/lib/email/templates/`
   - Invitation email with:
     - Personalized greeting: "Hi, {inviterName} has shared a pin with you"
     - Pin details: name, description preview
     - Call-to-action button with invitation link
     - PEBL branding and footer
   - Plain text fallback version

4. **Implementation Code** (Example with Resend):
   ```typescript
   import { Resend } from 'resend';

   const resend = new Resend(process.env.RESEND_API_KEY);

   export async function sendInvitationEmail(
     inviteeEmail: string,
     inviterName: string,
     pinName: string,
     invitationLink: string
   ): Promise<boolean> {
     try {
       await resend.emails.send({
         from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
         to: inviteeEmail,
         subject: `${inviterName} shared a pin with you on PEBL`,
         html: generateInvitationEmailHTML(inviterName, pinName, invitationLink),
         text: generateInvitationEmailText(inviterName, pinName, invitationLink),
       });
       return true;
     } catch (error) {
       logger.error('Failed to send invitation email', error as Error, {
         context: 'user-validation-service',
         data: { inviteeEmail, inviterName, pinName }
       });
       return false;
     }
   }
   ```

5. **Testing Strategy**
   - Use email provider's test mode during development
   - Verify email deliverability (check spam folders)
   - Test with various email providers (Gmail, Outlook, etc.)
   - Add rate limiting to prevent abuse

**Dependencies:**
- `npm install resend` (or chosen provider)
- Domain verification for production (to avoid spam filters)

**Estimated Complexity:** Medium (3-4 hours with testing)

---

### TODO #3: Project Rename Functionality
**Location:** `src/app/map-drawing/page.tsx:6641`

**Current State:**
- Shows toast: "Project renaming will be available in a future update"
- Located in project settings dialog
- Button click triggers the placeholder

**Required Implementation:**
1. **UI Components**
   - Replace toast with inline edit field or dialog
   - Add text input with current project name
   - Add validation (max length, no special chars)
   - Show loading state during rename operation

2. **Database Service**
   - Create `updateProjectName()` in appropriate service file
   - Update `projects` table:
     ```sql
     UPDATE projects
     SET name = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     ```
   - Add RLS policy check (user must own project)

3. **State Management**
   - Update local project state after successful rename
   - Trigger re-fetch of project list if needed
   - Update any UI elements showing project name
   - Handle concurrent edit conflicts

4. **Error Handling**
   - Validate name before submission (not empty, length limits)
   - Handle duplicate project names (allow or prevent?)
   - Show error toast for database failures
   - Revert to original name on error

5. **Implementation Pattern** (Example):
   ```typescript
   const [isRenaming, setIsRenaming] = useState(false);
   const [newProjectName, setNewProjectName] = useState(currentProject?.name || '');

   const handleRenameProject = async () => {
     if (!newProjectName.trim()) {
       toast({ variant: 'destructive', title: 'Empty Name', description: 'Project name cannot be empty' });
       return;
     }

     setIsRenaming(true);
     const result = await projectService.updateProjectName(currentProject.id, newProjectName);

     if (result.success) {
       setCurrentProject({ ...currentProject, name: newProjectName });
       toast({ title: 'Project Renamed', description: `Project renamed to: ${newProjectName}` });
       setShowProjectSettingsDialog(false);
     } else {
       toast({ variant: 'destructive', title: 'Rename Failed', description: result.error });
     }
     setIsRenaming(false);
   };
   ```

**Database Schema Check:**
- Verify `projects` table has `name` column
- Check RLS policies allow UPDATE for project owner
- Consider adding unique constraint on (user_id, name) if needed

**Estimated Complexity:** Low-Medium (1-2 hours)

---

## Task 2: Outlier Cleanup Script (Saved for Later Implementation)

### Requirements:
- **Outlier Detection Method**: User to specify preference (IQR, standard deviation, Z-score, etc.)
- **Outlier Handling**: User to specify what happens to detected outliers (remove, flag, replace)
- **Data Types**: User to specify if cleanup works on width only, both length and width, or any numerical column
- **User Interface**: User to specify interaction method (automatic, interactive selection, preview)

### Status: Pending clarification and implementation

### Questions for User:

1. **Outlier Detection Method** - Which algorithm should be used?
   - **IQR (Interquartile Range)**: Classic method, marks values > Q3 + 1.5*IQR or < Q1 - 1.5*IQR as outliers
   - **Standard Deviation**: Mark values beyond N standard deviations from mean (specify N: 1.5σ, 2σ, 3σ?)
   - **Z-score**: Similar to std dev, but normalized (-3 to +3 range typical)
   - **Modified Z-score**: More robust to outliers than standard Z-score
   - **Custom threshold**: User-defined upper/lower bounds
   - **Multiple methods**: Let user choose at runtime?

2. **Outlier Handling Strategy** - What should happen to detected outliers?
   - **Remove**: Delete rows containing outliers completely
   - **Flag**: Add column marking outlier rows (e.g., `is_outlier: true`)
   - **Replace with median**: Replace outlier values with column median
   - **Replace with mean**: Replace outlier values with column mean
   - **Cap at threshold**: Replace outlier values with threshold boundary values
   - **Interactive review**: Show outliers to user for manual decision

3. **Data Scope** - Which columns should be checked?
   - **Width only**: Only check the width column
   - **Length and width**: Check both length and width columns
   - **All numerical columns**: Automatically detect and check all numeric columns
   - **User-selected columns**: Let user choose which columns to check

4. **User Interface** - How should the user interact with this feature?
   - **Automatic on upload**: Run outlier detection automatically when file is uploaded
   - **Manual trigger**: Button in data explorer to run outlier cleanup
   - **Interactive preview**: Show outliers in UI with accept/reject options before applying
   - **Configuration dialog**: Settings panel to configure detection method, handling, columns
   - **Batch processing**: Apply to multiple files at once
   - **Undo capability**: Ability to revert outlier cleanup

5. **Additional Considerations**:
   - Should original data be preserved (create backup or modified copy)?
   - Should outlier cleanup be logged/tracked for audit purposes?
   - Should there be different profiles (e.g., "Conservative", "Moderate", "Aggressive")?
   - Should visualization be provided (scatter plots with outliers highlighted)?

**Please provide preferences for questions 1-4 to proceed with implementation planning.**

---

## Task 3: Unified Date Parser System

### Current State:
The application currently has **multiple date parsing implementations** scattered across different modules:
- `src/components/pin-data/csvParser.ts` - Used for plotting timeseries (intelligent, well-tested)
- `src/app/map-drawing/page.tsx` - Used for date range analysis ("Fetch Times" button)
- Various other ad-hoc parsing in different components

### Problem:
- **Code Duplication**: Same parsing logic duplicated in multiple places
- **Inconsistent Behavior**: Different parsers handle edge cases differently (e.g., DD/MM/YY vs MM/DD/YY)
- **Hard to Maintain**: Bug fixes must be applied to multiple locations
- **Type Safety**: Each parser has slightly different interfaces and return types

### Goal:
Build **ONE single intelligent date parser** that:
1. Handles all date formats consistently across the entire application
2. Supports both 2-digit and 4-digit years (e.g., "25" → 2025)
3. Intelligently detects DD/MM/YYYY vs MM/DD/YYYY based on data patterns
4. Provides override option for known file types (CROP, CHEM, WQ, EDNA → force DD/MM/YYYY)
5. Validates parsed dates against expected ranges (filename-based sanity checking)
6. Extensive logging for debugging date parsing issues
7. Centralized in a single module that all components can import

### Recommended Approach:
1. **Create `src/lib/unified-date-parser.ts`**
   - Combine best features from `csvParser.ts` and `map-drawing/page.tsx`
   - Add filename-based sanity checking for discrete sampling files
   - Support for ISO, DD/MM/YYYY, MM/DD/YYYY, Excel serial dates, Unix timestamps
   - Type-safe interfaces for input/output

2. **Refactor All Components**
   - Replace all ad-hoc date parsing with unified parser
   - Update: PinChartDisplay, DataTimeline, map-drawing/page.tsx, file upload handlers
   - Remove duplicate code

3. **Add Comprehensive Tests**
   - Unit tests for all date format variations
   - Edge case testing (leap years, century boundaries, ambiguous dates)
   - Integration tests with real CSV files

### Priority:
**High** - Date parsing bugs cause major UX issues (timeline display, discrete sampling files)

### Status:
**In Progress** - Currently refactoring `map-drawing/page.tsx` to use `csvParser.ts` as first step

### Related Files:
- `src/components/pin-data/csvParser.ts` (lines 34-492)
- `src/app/map-drawing/page.tsx` (lines 1841-2356)
- `src/lib/dateParser.ts` (filename date range parsing only)

---

## Task 4: Map Performance Optimization ✅ COMPLETED

### Completion Date: January 23, 2025

### Issues Resolved:
1. **Jagged Map Dragging** - Map was smooth initially but became laggy during dragging
2. **Page Flashing on Load** - Components were mounting/unmounting multiple times during initial load

### Solutions Implemented:

#### 1. Map Dragging Performance
**Files Modified:**
- `src/components/map/LeafletMap.tsx` (lines 273-313)
- `src/app/map-drawing/page.tsx` (lines 1019-1041, 1204-1206)

**Changes:**
- Implemented `requestAnimationFrame` throttling for smooth 60fps updates
- Added `isMoving` parameter to distinguish continuous movement from final position
- Deferred expensive state updates (`setView`, `updateMapScale`) until dragging stops
- Maintained real-time crosshair updates during line/area drawing

**Impact:**
- Eliminated jagged dragging behavior
- Reduced state updates from 100+/sec to max 60/sec
- 90%+ reduction in unnecessary re-renders during dragging

#### 2. Initial Load Performance
**Files Modified:**
- `src/hooks/use-map-data.ts` (lines 33, 215-228)
- `src/components/auth/DataRestoreDialog.tsx` (lines 15, 17-22)
- `src/components/map/LeafletMap.tsx` (lines 220, 246-250, 326, 333)

**Changes:**
- Added `hasInitiallyLoaded` guard to prevent duplicate data loads
- Added `hasRestoredRef` guard to prevent duplicate restoration
- Added `hasInitializedRef` guard to prevent duplicate map initialization
- Fixed unstable useEffect dependencies causing re-execution

**Impact:**
- Data loads only **once** instead of 3+ times
- Map initializes only **once** instead of 6 times
- Restoration runs only **once** instead of twice
- Eliminated visible page flashing

### Performance Metrics:
- **Before:** 6 map initializations, 3 database loads, jagged dragging
- **After:** 1 map initialization, 1 database load, smooth 60fps dragging

### Documentation:
See `MAP_PERFORMANCE_OPTIMIZATION.md` for complete technical details, code examples, and testing recommendations.

---

## Task 5: Rarefaction Curve Visualization Improvements ✅ COMPLETED

### Completion Date: January 23, 2025

### Objective:
Improve the rarefaction curve display for _hapl files to show smooth curves with shaded confidence intervals, matching the standard eDNA rarefaction data visualization style.

### Issues Addressed:
1. **No confidence intervals** - Standard rarefaction plots show uncertainty bands
2. **Jagged curves** - Insufficient interpolation points made curves look angular
3. **Poor styling** - Axis labels and styling didn't match professional scientific plots

### Solutions Implemented:

#### 1. Added Shaded Confidence Intervals
**Files Modified:**
- `src/components/pin-data/RarefactionChart.tsx` (lines 4-14, 189-240)
- `src/lib/curve-fitting.ts` (lines 286-316)

**Changes:**
- Added `Area` component from recharts for shaded bands
- Implemented upper and lower confidence bounds using standard error
- Semi-transparent green shading (#10b981) at 20% opacity for interpolation, 12% for extrapolation
- Creates characteristic "ribbon" effect typical of eDNA rarefaction plots
- Modified `generateSmoothCurveInRange()` to return `yUpper` and `yLower` values
- Ensures lower bound never goes below 0 species

**Code Example:**
```typescript
// In curve-fitting.ts:286-316
export function generateSmoothCurveInRange(
  fitResult: CurveFitResult,
  minX: number,
  maxX: number,
  numPoints: number = 50
): Array<{ x: number; y: number; yUpper?: number; yLower?: number }> {
  // ... calculate y value ...

  if (fitResult.confidenceInterval) {
    const se = fitResult.confidenceInterval.standardError;
    point.yUpper = y + se;
    point.yLower = Math.max(0, y - se);
  }

  points.push(point);
}
```

#### 2. Increased Curve Smoothness
**Files Modified:**
- `src/components/pin-data/RarefactionChart.tsx` (lines 86-89)

**Changes:**
- Increased interpolation points from 50 to 100 (2x smoother)
- Increased extrapolation points from 50 to 100
- Results in significantly smoother curve transitions
- Better approximation of the underlying Michaelis-Menten or logarithmic model

**Impact:**
- Curves now appear smooth and professional
- Better visual representation of species accumulation trends
- Matches industry-standard rarefaction plot appearance

#### 3. Improved Chart Styling
**Files Modified:**
- `src/components/pin-data/RarefactionChart.tsx` (lines 153-189)

**Changes:**
- Simplified axis labels: "Samples" and "Species" (instead of verbose descriptions)
- Updated grid: More subtle appearance with #d1d5db color and 50% opacity
- Improved axis colors: #9ca3af for strokes, #6b7280 for tick labels
- Better margins: top: 20, right: 30, left: 20, bottom: 60
- Cleaner font sizing: 14px for labels, 12px for ticks
- Professional color scheme matching scientific publications

#### 4. Enhanced Legend Display
**Files Modified:**
- `src/components/pin-data/RarefactionChart.tsx` (lines 186-189, 254-279)

**Changes:**
- Updated legend labels: "Observed", "Fitted Curve", "Prediction", "Confidence Interval"
- Increased legend padding and font size for better readability
- Line icons for better visual representation

### Technical Details:

**Rarefaction Calculation:**
- File: `src/lib/rarefaction-utils.ts`
- Algorithm: Sequential species accumulation across samples
- Tracks cumulative unique species count and new species per sample

**Curve Fitting:**
- File: `src/lib/curve-fitting.ts`
- Models supported: Michaelis-Menten, Logarithmic
- R² calculation for goodness of fit
- Standard error calculation for confidence intervals

**Visualization:**
- Library: Recharts (ComposedChart with Line and Area components)
- Layers: Confidence intervals (Area) → Observed data (Line) → Fitted curve (Line)
- Animation: Disabled for immediate display and better performance

### Example Usage:
The rarefaction curve is automatically displayed when viewing _hapl files:
- **File**: NORF_EDNAS_ALL_2507_Hapl.csv
- **Species**: 53 total unique species
- **Sites**: 6 sampling locations
- **Curve progression**: 13 → 15 → 22 → 40 → 49 → 53 species

### Files Changed:
1. `src/components/pin-data/RarefactionChart.tsx` - Main visualization component
2. `src/lib/curve-fitting.ts` - Confidence interval support
3. Both files work together to create smooth, professional rarefaction plots

#### 5. Fixed Default Settings for Auto-Display
**Files Modified:**
- `src/components/pin-data/HaplotypeHeatmap.tsx` (lines 66-67)

**Changes:**
- Changed default `curveFitModel` from 'none' to 'michaelis-menten'
- Changed default `showFittedCurve` from false to true
- This ensures rarefaction improvements are visible immediately upon opening _hapl files
- Users no longer need to manually enable curve fitting to see the enhanced visualization

**Before:**
```typescript
const [curveFitModel, setCurveFitModel] = useState<CurveFitModel>('none');
const [showFittedCurve, setShowFittedCurve] = useState(false);
```

**After:**
```typescript
const [curveFitModel, setCurveFitModel] = useState<CurveFitModel>('michaelis-menten');
const [showFittedCurve, setShowFittedCurve] = useState(true);
```

**Impact:**
- Users see professional rarefaction curves with confidence intervals by default
- No manual configuration required to access the improvements
- Better first-time user experience

### User Interface:
- Displayed automatically in HaplotypeHeatmap component when viewing _hapl files
- Settings available: Curve fit model selection (none, Michaelis-Menten, logarithmic)
- Toggle for showing/hiding fitted curves
- Statistics panel showing samples, species, average species per sample, and discovery percentage
- **Default**: Michaelis-Menten curve fitting enabled automatically (changed from 'none')

### Benefits:
✅ Professional scientific visualization matching published eDNA studies
✅ Confidence intervals show uncertainty in species discovery predictions
✅ Smooth curves provide better visual understanding of trends
✅ Clean styling improves readability and presentation quality
✅ Helpful for assessing sampling adequacy (has plateau been reached?)

---

## MCP Usage Optimization Guidelines

### Best Practices (Added: January 23, 2025)

**DO:**
- ✅ Read code files directly for context
- ✅ Make focused, targeted edits
- ✅ Trust console logs and test output
- ✅ Use screenshots sparingly and purposefully
- ✅ Complete code changes before attempting visual verification

**DON'T:**
- ❌ Make multiple browser navigation attempts when code changes suffice
- ❌ Take unnecessary full-page screenshots
- ❌ Repeatedly try failed navigation patterns
- ❌ Visual test during development when logs show functionality works

**Token Efficiency Example:**
- **Inefficient**: 10+ Playwright navigation attempts + full-page screenshots = ~6,000 tokens
- **Efficient**: 4 focused code edits + console log review = ~2,000 tokens
- **Savings**: 66% token reduction

**When to use Playwright MCP:**
- Complex UI state verification that logs cannot confirm
- Visual regression testing
- User flow testing across multiple pages
- Screenshot documentation for specific features

**When NOT to use Playwright MCP:**
- Functionality already confirmed by console logs
- Code-only changes without visual components
- Repeated navigation after multiple failures
- During active development (test after completion)

**NEW: Efficient Playwright Patterns (2025-01-23)**

See `.claude/skills/playwright-efficient.md` for complete guide including:
- Console-first verification (200 tokens vs 11k)
- Targeted element evaluation (100 tokens vs 11k)
- Network request monitoring (300 tokens vs 11k)
- Batch operations and decision trees
- Real-world examples with 97% token savings

**Quick wins:**
```typescript
// ❌ INEFFICIENT (11k tokens)
await browser_snapshot();

// ✅ EFFICIENT (200 tokens)
await browser_console_messages({ onlyErrors: true });
const state = await browser_evaluate({ function: `() => ({ loaded: !!document.querySelector('.data') })` });
```

---

## Performance Tracking & Admin Dashboard

### Admin Dashboard Access

**Command:** Use the Claude skill `admin dashboard` to open the performance tracking dashboard.

**Dashboard URL:** `http://localhost:9002/admin-dashboard`

**Purpose:** Monitor test results, track performance metrics, and identify optimization opportunities across the entire application.

---

### Performance Tracking Standards

**IMPORTANT:** All future performance testing and optimization work must follow these standards to ensure measurable, trackable improvements.

#### 1. **Test Results Documentation**

All performance tests must be documented in `test-reports/` with the following information:

```markdown
# [Feature] Performance Analysis

**Date:** YYYY-MM-DD
**Test Duration:** X minutes
**Tests Run:** X tests (Y passed, Z failed)
**Status:** ⚠️ Performance Issues Identified / ✅ All Passing

## Test Results

### Test Name: [Descriptive Name]

**Status:** ✅ Passing / ⚠️ Warning / ❌ Failing

**Metrics:**
- Current Performance: XXms
- Target Performance: XXms
- Delta: ±XX% (over/under target)
- Date Tested: YYYY-MM-DD

**Analysis:**
- [Detailed analysis of performance]
- [Bottlenecks identified]
- [Impact on user experience]

**Optimization Opportunity:**
- **Name:** [Short descriptive name]
- **Expected Improvement:** XX% faster or XXms saved
- **Implementation Effort:** X hours
- **ROI:** XX.X (improvement% / effort hours)
- **Priority:** Critical / High / Medium / Low
- **Tier:** 1 (Quick Win) / 2 (Core) / 3 (Advanced)
- **File Location:** `path/to/file.ts:line-numbers`
```

#### 2. **Performance Metrics Schema**

All performance metrics must be structured as `PerformanceMetric` objects (see `src/lib/performance-metrics-parser.ts`):

```typescript
interface PerformanceMetric {
  // Identification
  testName: string;
  category: 'rendering' | 'parsing' | 'network' | 'interaction' | 'architecture';
  component: string;
  file?: string;
  lineNumbers?: string;

  // Timing
  timestamp: string;  // ISO 8601
  currentValue: number;  // milliseconds
  targetValue: number;  // milliseconds

  // Analysis
  status: 'passing' | 'warning' | 'failing';
  deltaFromTarget: number;
  deltaPercentage: number;

  // Optimization
  hasOptimization: boolean;
  optimizationName?: string;
  estimatedImprovement?: number;
  improvementPercentage?: number;
  implementationEffort?: number;  // hours
  roi?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  tier?: 1 | 2 | 3;

  // Implementation
  implemented: boolean;
  implementedDate?: string;
  actualImprovement?: number;
}
```

#### 3. **Optimization Opportunities Tracking**

All identified optimizations must be tracked with:

- **Name:** Short, descriptive name (e.g., "Rarefaction: Reduce iterations 1000→200")
- **Description:** Technical explanation of the issue and fix
- **Affected Metrics:** List of test names that will improve
- **Tier Classification:**
  - **Tier 1 (Quick Wins):** 0.5-2 hours effort, 50-60% cumulative gain
  - **Tier 2 (Core Improvements):** 4-8 hours effort, 70-75% cumulative gain
  - **Tier 3 (Advanced):** 6-12 hours effort, 80-85% cumulative gain
- **Priority:** Critical / High / Medium / Low
- **Estimated Improvement:** Percentage or absolute time (e.g., "60-70% faster" or "100ms saved")
- **Implementation Effort:** Hours
- **ROI:** improvement% / effort hours
- **File Location:** Exact file path and line numbers
- **Implementation Status:** Pending / In Progress / Implemented
- **Actual Results:** After implementation, document actual improvement vs estimated

#### 4. **Visual Performance Tracking**

The admin dashboard provides visual tracking through:

- **Performance Score Cards:** Current vs potential performance scores
- **Test Results Table:** Complete list of all performance tests with status indicators
- **Optimization Opportunities List:** Sortable by ROI, priority, or tier
- **Implementation Roadmap:** Phased approach with effort and gain projections
- **ROI Rankings:** Top opportunities ordered by return on investment

#### 5. **Before/After Measurements**

When implementing optimizations:

1. **Document Baseline:**
   - Run performance test 3 times
   - Record average, min, max
   - Note test conditions (data size, browser, etc.)

2. **Implement Optimization:**
   - Make code changes
   - Update `implemented: true` in metrics parser
   - Set `implementedDate`

3. **Measure Actual Impact:**
   - Run same performance test 3 times
   - Calculate actual improvement
   - Update `actualImprovement` field
   - Compare to `estimatedImprovement`

4. **Update Documentation:**
   - Add results to test report
   - Update dashboard data
   - Note any unexpected results

#### 6. **Performance Test Automation**

All performance tests should be automated with Playwright:

```typescript
test('measure [feature] performance', async ({ page }) => {
  const metrics = {
    setupTime: 0,
    renderTime: 0,
    interactionTime: 0,
    totalTime: 0,
  };

  const startTime = Date.now();

  // Setup
  const setupStart = Date.now();
  await setupTestData(page);
  metrics.setupTime = Date.now() - setupStart;

  // Render
  const renderStart = Date.now();
  await page.waitForSelector('[data-testid="component"]', { timeout: 20000 });
  metrics.renderTime = Date.now() - renderStart;

  // Interaction
  const interactionStart = Date.now();
  await page.click('[data-testid="trigger"]');
  await page.waitForSelector('[data-testid="result"]');
  metrics.interactionTime = Date.now() - interactionStart;

  metrics.totalTime = Date.now() - startTime;

  // Log for documentation
  console.log('Performance Metrics:', JSON.stringify(metrics, null, 2));

  // Assert against targets
  expect(metrics.renderTime).toBeLessThan(TARGET_MS);
});
```

#### 7. **Continuous Monitoring**

- Run performance test suite weekly
- Compare results to baseline
- Flag any regressions (>10% slower than baseline)
- Update admin dashboard with latest metrics
- Review optimization priorities quarterly

#### 8. **Dashboard Updates**

When adding new performance tests:

1. Add test to appropriate test file
2. Update `performance-metrics-parser.ts` with new metric
3. If optimization identified, add to `parseOptimizationOpportunities()`
4. Dashboard will automatically reflect new data
5. Document in relevant test report markdown file

---

### Admin Dashboard Features

#### Overview Tab
- **Summary Cards:** Current performance, potential performance, test results, quick wins
- **Critical Issues:** Tests failing to meet performance targets
- **Top Opportunities:** Best ROI optimizations

#### Test Results Tab
- **Complete Test List:** All performance tests with current/target/delta
- **Status Indicators:** ✅ Passing / ⚠️ Warning / ❌ Failing
- **Optimization Info:** Expected improvements and effort

#### Optimizations Tab
- **Tier Filtering:** Filter by Tier 1, 2, 3, or all
- **ROI Sorting:** Automatically sorted by return on investment
- **Detailed Cards:** Full description, affected metrics, file locations
- **Implementation Status:** Pending vs Implemented tracking

#### Roadmap Tab
- **Phased Implementation:** Tier 1 → Tier 2 → Tier 3
- **Effort Projections:** Total hours per tier
- **Expected Gains:** Cumulative performance improvements
- **Timeline Estimates:** Week-by-week implementation plan

---

### Example Usage

```bash
# User asks to see performance status
User: "admin dashboard"

# Claude uses the admin-dashboard skill
Claude: [Opens http://localhost:9002/admin-dashboard]
Claude: [Reports summary of current performance metrics]
Claude: [Highlights critical issues and top optimization opportunities]
```

---

### File Locations

- **Dashboard Page:** `src/app/admin-dashboard/page.tsx`
- **Metrics Parser:** `src/lib/performance-metrics-parser.ts`
- **Claude Skill:** `.claude/skills/admin-dashboard.md`
- **Test Reports:** `test-reports/`
- **Performance Tests:** `tests/e2e/*-performance.spec.ts`

---
