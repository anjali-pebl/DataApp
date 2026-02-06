/**
 * Centralized timezone utilities for consistent date handling across the application.
 *
 * Dates in CSV files represent dates at the pin/area's physical location.
 * All date formatting should use the location's timezone (derived from coordinates)
 * rather than the viewer's local machine timezone.
 */

/**
 * Estimate timezone offset (in hours from UTC) from longitude.
 * Each 15 degrees of longitude ≈ 1 hour offset.
 * More accurate than using the viewer's local machine timezone for remote locations.
 */
export function getTimezoneOffsetFromLongitude(lng: number): number {
  return Math.round(lng / 15);
}

/**
 * Format a UTC Date using UTC methods, avoiding local timezone conversion.
 * This ensures dates display consistently regardless of the viewer's timezone.
 *
 * Supported format strings:
 * - 'dd-MM-yy'    → "31-07-24"
 * - 'dd/MM/yyyy'  → "31/07/2024"
 * - 'yyyy-MM-dd'  → "2024-07-31"
 * - 'MMM d, yyyy' → "Jul 31, 2024"
 * - 'dd/MM HH:mm' → "31/07 14:30"
 * - 'HH:mm'       → "14:30"
 */
export function formatDateUTC(date: Date, formatStr: string): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const shortYear = String(year).slice(-2);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[date.getUTCMonth()];

  const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fullMonthName = fullMonthNames[date.getUTCMonth()];

  switch (formatStr) {
    case 'dd-MM-yy':
      return `${day}-${month}-${shortYear}`;
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${String(month).padStart(2, '0')}-${day}`;
    case 'MMM d, yyyy':
      return `${monthName} ${date.getUTCDate()}, ${year}`;
    case 'MMM yyyy':
      return `${monthName} ${year}`;
    case 'MMMM yyyy':
      return `${fullMonthName} ${year}`;
    case 'MM':
      return month;
    case 'dd/MM HH:mm':
      return `${day}/${month} ${hours}:${minutes}`;
    case 'HH:mm':
      return `${hours}:${minutes}`;
    default:
      return `${day}/${month}/${year}`;
  }
}

/**
 * Format a UTC Date adjusted by a timezone offset (in hours).
 * Use this when you need to display times in the pin/area's local timezone.
 */
export function formatDateInTimezone(date: Date, offsetHours: number, formatStr: string): string {
  const utcTime = date.getTime();
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const adjustedDate = new Date(utcTime + offsetMs);
  return formatDateUTC(adjustedDate, formatStr);
}

/**
 * Parse a date string to a UTC Date object.
 * Handles DD/MM/YYYY, YYYY-MM-DD, and ISO formats.
 * Always returns UTC midnight to avoid timezone ambiguity.
 */
export function parseDateToUTC(dateString: string): Date | null {
  if (!dateString) return null;

  // Handle DD/MM/YYYY format
  const slashParts = dateString.split('/');
  if (slashParts.length === 3) {
    const [day, month, year] = slashParts.map(Number);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  // Handle YYYY-MM-DD format (strip any time component first)
  const dateOnly = dateString.split('T')[0];
  const dashParts = dateOnly.split('-');
  if (dashParts.length === 3) {
    const [year, month, day] = dashParts.map(Number);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  return null;
}

// ============================================================================
// UTC-aware replacements for date-fns functions
// These avoid the local timezone shift that date-fns applies to UTC dates.
// ============================================================================

/** UTC version of startOfMonth - returns first day of month at UTC midnight */
export function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** UTC version of endOfMonth - returns last day of month at UTC midnight */
export function endOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** UTC version of eachMonthOfInterval - generates first-of-month dates in UTC */
export function eachMonthOfIntervalUTC(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  let current = startOfMonthUTC(start);
  const endMonth = startOfMonthUTC(end);

  while (current <= endMonth) {
    months.push(current);
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }
  return months;
}

/** UTC version of differenceInDays - calculates days between two UTC dates */
export function differenceInDaysUTC(end: Date, start: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}
