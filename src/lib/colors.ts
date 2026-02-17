/**
 * Centralized Colorblind-Friendly Color Palette
 *
 * Based on Paul Tol's color schemes for accessibility:
 * https://personal.sron.nl/~pault/
 *
 * These colors maintain good contrast and are distinguishable
 * for people with various types of color vision deficiency.
 */

/**
 * Primary colorblind-friendly palette (16 colors)
 * Ordered to maximize visual difference between adjacent colors
 */
export const COLORBLIND_PALETTE = [
  '#4477AA', // Blue
  '#EE6677', // Red/pink
  '#228833', // Green
  '#CCBB44', // Olive yellow
  '#66CCEE', // Cyan
  '#AA3377', // Purple
  '#BBBBBB', // Grey
  '#CC6644', // Burnt orange
  '#336688', // Steel blue
  '#885533', // Brown
  '#779944', // Moss green
  '#AA6688', // Mauve
  '#557799', // Slate
  '#886644', // Tan brown
  '#668844', // Olive green
  '#995566', // Dusty rose
] as const;

/**
 * Short palette (8 colors) for simpler visualizations
 * Selected for maximum contrast
 */
export const COLORBLIND_PALETTE_SHORT = [
  '#4477AA', // Blue
  '#EE6677', // Red/pink
  '#228833', // Green
  '#CCBB44', // Olive yellow
  '#66CCEE', // Cyan
  '#AA3377', // Purple
  '#CC6644', // Burnt orange
  '#BBBBBB', // Grey
] as const;

/**
 * Get a color from the palette by index (wraps around)
 */
export function getColorByIndex(index: number, useShortPalette = false): string {
  const palette = useShortPalette ? COLORBLIND_PALETTE_SHORT : COLORBLIND_PALETTE;
  return palette[index % palette.length];
}

/**
 * Generate a consistent color for a string (hash-based)
 * Same string always returns same color
 */
export function getColorForString(str: string, useShortPalette = false): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = useShortPalette ? COLORBLIND_PALETTE_SHORT : COLORBLIND_PALETTE;
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

/**
 * Get multiple colors for an array of items
 * Maintains consistency - same item always gets same color
 */
export function getColorsForItems(items: string[], useShortPalette = false): Map<string, string> {
  const colorMap = new Map<string, string>();
  items.forEach((item, index) => {
    colorMap.set(item, getColorByIndex(index, useShortPalette));
  });
  return colorMap;
}

/**
 * CSS variable names for chart colors (for Tailwind/CSS integration)
 * These should be defined in globals.css with colorblind-friendly values
 */
export const CHART_COLOR_VARS = [
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--chart-6', '--chart-7', '--chart-8', '--chart-9'
] as const;

/**
 * Default export for convenience
 */
export default COLORBLIND_PALETTE;
