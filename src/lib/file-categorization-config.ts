/**
 * File Categorization Configuration
 *
 * This module defines how files are categorized into tiles and categories
 * based on filename pattern matching.
 *
 * Rules:
 * - Files are matched by checking if the filename contains specific strings
 * - A file can match multiple patterns and appear in multiple tiles
 * - Categories are optional - some patterns assign files to tiles without categories
 */

// ---------- Media file constants ----------

export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif'];
export const DOCUMENT_EXTENSIONS = ['.pdf'];
export const MEDIA_EXTENSIONS = [...PHOTO_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

/** Accept string for file input elements — CSV + all media types */
export const ALL_ACCEPT_STRING = '.csv,' + MEDIA_EXTENSIONS.join(',');

/** Check if a filename is a photo */
export function isPhotoFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PHOTO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/** Check if a filename is a PDF */
export function isPdfFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf');
}

/** Check if a filename is a media file (photo or PDF) */
export function isMediaFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return MEDIA_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export interface FileCategoryRule {
  /** String that must be contained in the filename (case-insensitive by default) */
  contains: string;
  /** Which tile this file should appear in */
  tile: string;
  /** Optional category within the tile */
  category?: string;
  /** If true, matching is case-sensitive. Default is case-insensitive. */
  caseSensitive?: boolean;
  /** If set, the pattern will NOT match if the filename contains this string */
  excludeIfContains?: string;
}

export interface FileCategoryMatch {
  tile: string;
  category?: string;
}

/**
 * File categorization rules based on filename patterns
 * Order matters: earlier rules are checked first
 */
export const FILE_CATEGORY_RULES: FileCategoryRule[] = [
  // SubCam - no categories
  {
    contains: 'SUBCAM',
    tile: 'SubCam',
  },

  // GrowProbe - no categories
  {
    contains: 'GP',
    tile: 'GrowProbe',
  },

  // FPOD - with Std and Avg 24hrs categories
  {
    contains: '_std',
    tile: 'FPOD',
    category: 'Std',
  },
  {
    contains: '24hr',
    tile: 'FPOD',
    category: 'Avg 24hrs',
  },
  {
    contains: 'FPOD',
    tile: 'FPOD',
  },

  // Water and Crop Samples - with categories
  {
    contains: 'CHEMSW',
    tile: 'Water and Crop Samples',
    category: 'Crop Chem',
  },
  {
    contains: 'CHEMWQ',
    tile: 'Water and Crop Samples',
    category: 'Water Chem',
  },
  {
    contains: 'Crop',
    tile: 'Water and Crop Samples',
    category: 'Crop Growth',
  },

  // eDNA - with categories
  {
    contains: 'EDNAS',
    tile: 'eDNA',
    category: 'Sediment',
  },
  {
    contains: 'EDNAW',
    tile: 'eDNA',
    category: 'Water',
  },
  {
    contains: 'Hapl',
    tile: 'eDNA',
    category: 'Haplotypes',
  },
  {
    contains: 'Taxo',
    tile: 'eDNA',
    category: 'Taxonomy',
  },
  {
    contains: 'Cred',
    tile: 'eDNA',
    category: 'Credibility Score',
  },
  {
    contains: 'Meta',
    tile: 'eDNA',
    category: 'Metadata',
    excludeIfContains: 'META', // All-caps META has different meaning, not eDNA metadata
  },
];

/**
 * All possible tile names in display order
 */
export const TILE_NAMES = [
  'SubCam',
  'GrowProbe',
  'FPOD',
  'Water and Crop Samples',
  'eDNA',
  'Media',
] as const;

export type TileName = typeof TILE_NAMES[number];

/**
 * Categorize a file based on its filename
 * Returns all matching tiles and categories (a file can match multiple rules)
 *
 * @param filename - The filename to categorize
 * @returns Array of tile/category matches
 */
export function categorizeFile(filename: string): FileCategoryMatch[] {
  const matches: FileCategoryMatch[] = [];
  const upperFilename = filename.toUpperCase();

  for (const rule of FILE_CATEGORY_RULES) {
    // Check exclusion first - if filename contains excluded string, skip this rule
    if (rule.excludeIfContains && filename.includes(rule.excludeIfContains)) {
      continue;
    }

    // Check if rule matches (case-sensitive or case-insensitive)
    let isMatch: boolean;
    if (rule.caseSensitive) {
      isMatch = filename.includes(rule.contains);
    } else {
      isMatch = upperFilename.includes(rule.contains.toUpperCase());
    }

    if (isMatch) {
      matches.push({
        tile: rule.tile,
        category: rule.category,
      });
    }
  }

  return matches;
}

/**
 * Get all unique categories for a specific tile from the rules
 *
 * @param tileName - The tile to get categories for
 * @returns Array of category names (excluding undefined/empty categories)
 */
export function getCategoriesForTile(tileName: string): string[] {
  const categories = FILE_CATEGORY_RULES
    .filter(rule => rule.tile === tileName && rule.category)
    .map(rule => rule.category!);

  // Return unique categories
  return Array.from(new Set(categories));
}

/**
 * Check if a tile has categories
 *
 * @param tileName - The tile to check
 * @returns True if the tile has any categories defined
 */
export function tileHasCategories(tileName: string): boolean {
  return FILE_CATEGORY_RULES.some(
    rule => rule.tile === tileName && rule.category
  );
}

/**
 * Get all files that belong to a specific tile
 *
 * @param files - Array of file objects with fileName property
 * @param tileName - The tile to filter for
 * @returns Filtered array of files
 */
export function getFilesForTile<T extends { fileName: string }>(
  files: T[],
  tileName: string
): T[] {
  return files.filter(file => {
    const matches = categorizeFile(file.fileName);
    return matches.some(match => match.tile === tileName);
  });
}

/**
 * Get all files for a specific tile and category
 *
 * @param files - Array of file objects with fileName property
 * @param tileName - The tile to filter for
 * @param category - The category to filter for (optional)
 * @returns Filtered array of files
 */
export function getFilesForTileAndCategory<T extends { fileName: string }>(
  files: T[],
  tileName: string,
  category?: string
): T[] {
  return files.filter(file => {
    const matches = categorizeFile(file.fileName);
    return matches.some(match =>
      match.tile === tileName &&
      (!category || match.category === category)
    );
  });
}
