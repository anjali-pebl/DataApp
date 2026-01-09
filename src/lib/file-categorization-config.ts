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

export interface FileCategoryRule {
  /** String that must be contained in the filename (case-insensitive) */
  contains: string;
  /** Which tile this file should appear in */
  tile: string;
  /** Optional category within the tile */
  category?: string;
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

  // FPOD - with optional 24hr category
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
    if (upperFilename.includes(rule.contains.toUpperCase())) {
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
