/**
 * Taxonomy Service
 *
 * Provides integration with WoRMS (World Register of Marine Species) and GBIF
 * (Global Biodiversity Information Facility) APIs for taxonomic classification.
 *
 * Features:
 * - WoRMS API integration (primary for marine species)
 * - GBIF API integration (fallback for all species)
 * - Supabase database caching (permanent storage)
 * - Local storage caching (7-day expiry, fallback)
 * - Batch processing with concurrency control
 * - Confidence scoring for match quality
 */

import { createClient } from '@/lib/supabase/client';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface TaxonomyResult {
  source: 'worms' | 'gbif' | 'unknown';
  scientificName: string;
  rank: string;
  taxonId: string; // AphiaID (WoRMS) or usageKey (GBIF)
  commonNames: string[];
  hierarchy: TaxonomicHierarchy;
  confidence: 'high' | 'medium' | 'low';
  matchType: 'exact' | 'fuzzy' | 'none';
}

export interface TaxonomicHierarchy {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

interface CacheEntry {
  data: TaxonomyResult;
  timestamp: number;
}

interface WoRMSRecord {
  AphiaID: number;
  scientificname: string;
  rank: string;
  status: string;
  match_type: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  vernaculars?: Array<{ vernacular: string }>;
}

interface WoRMSClassification {
  AphiaID: number;
  scientificname: string;
  rank: string;
  child?: WoRMSClassification | null;
}

interface GBIFMatch {
  usageKey: number;
  scientificName: string;
  rank: string;
  status: string;
  matchType: string;
  confidence: number;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  vernacularName?: string;
}

// ============================================================================
// Constants
// ============================================================================

const WORMS_BASE_URL = 'https://www.marinespecies.org/rest';
const GBIF_BASE_URL = 'https://api.gbif.org/v1';
const CACHE_KEY = 'taxonomy-cache-v1';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CONCURRENT_REQUESTS = 5;
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Get taxonomy data from Supabase database
 */
async function getTaxonomyFromDB(speciesName: string): Promise<TaxonomyResult | null> {
  try {
    const supabase = createClient();
    const normalizedName = normalizeSpeciesName(speciesName);

    const { data, error } = await supabase
      .from('species_taxonomy')
      .select('*')
      .eq('species_name', normalizedName)
      .single();

    if (error || !data) {
      return null;
    }

    console.log(`🗄️ Database hit for: ${speciesName} (cached source: ${data.taxonomy_source?.toUpperCase()})`);

    return {
      source: data.taxonomy_source as 'worms' | 'gbif' | 'unknown',
      scientificName: speciesName,
      rank: data.rank,
      taxonId: data.taxon_id,
      commonNames: data.common_names || [],
      hierarchy: data.hierarchy || {},
      confidence: data.confidence as 'high' | 'medium' | 'low',
      matchType: (data.match_type || 'exact') as 'exact' | 'fuzzy' | 'none'
    };
  } catch (error) {
    console.error('Database read error:', error);
    return null;
  }
}

/**
 * Save taxonomy data to Supabase database
 */
async function saveTaxonomyToDB(speciesName: string, taxonomy: TaxonomyResult): Promise<boolean> {
  try {
    const supabase = createClient();
    const normalizedName = normalizeSpeciesName(speciesName);

    const { error } = await supabase
      .from('species_taxonomy')
      .upsert({
        species_name: normalizedName,
        taxonomy_source: taxonomy.source,
        taxon_id: taxonomy.taxonId,
        common_names: taxonomy.commonNames,
        hierarchy: taxonomy.hierarchy,
        confidence: taxonomy.confidence,
        rank: taxonomy.rank,
        match_type: taxonomy.matchType,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'species_name'
      });

    if (error) {
      console.error(`Failed to save taxonomy for ${speciesName}:`, error);
      return false;
    }

    console.log(`💾 Saved to database: ${speciesName}`);
    return true;
  } catch (error) {
    console.error('Database write error:', error);
    return false;
  }
}

// ============================================================================
// Local Storage Caching Functions (Fallback)
// ============================================================================

function getCachedTaxonomy(speciesName: string): TaxonomyResult | null {
  try {
    const cache = localStorage.getItem(CACHE_KEY);
    if (!cache) return null;

    const parsed = JSON.parse(cache);
    const normalizedName = normalizeSpeciesName(speciesName);
    const entry: CacheEntry = parsed[normalizedName];

    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      // Cache expired
      return null;
    }

    console.log(`📦 Cache hit for: ${speciesName}`);
    return entry.data;
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
}

function setCachedTaxonomy(speciesName: string, data: TaxonomyResult): void {
  try {
    const cache = localStorage.getItem(CACHE_KEY);
    const parsed = cache ? JSON.parse(cache) : {};
    const normalizedName = normalizeSpeciesName(speciesName);

    parsed[normalizedName] = {
      data,
      timestamp: Date.now()
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

function clearTaxonomyCache(): void {
  localStorage.removeItem(CACHE_KEY);
  console.log('🗑️ Taxonomy cache cleared');
}

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeSpeciesName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Clean species name for API lookups by removing rank indicators
 * e.g., "Gadus morhua (sp.)" -> "Gadus morhua"
 * e.g., "Actinopterygii (class)" -> "Actinopterygii"
 * e.g., "Gadus sp." -> "Gadus" (genus-level eDNA identification)
 * e.g., "Scombridae spp." -> "Scombridae"
 * e.g., "Species name (sp.)." -> "Species name" (handles double period from SubCam)
 */
function cleanSpeciesNameForLookup(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')                    // Normalize whitespace
    .replace(/\s*\(.*?\)\.?\s*$/g, '')       // Remove trailing parenthetical content like (sp.), (sp.)., (class)
    .replace(/\s+(sp\.?|spp\.?|gen\.?|fam\.?|ord\.?|class\.?)$/i, '')  // Remove trailing rank abbreviations (with or without dot)
    .trim();
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function fetchWithTimeout(url: string, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ============================================================================
// WoRMS API Functions
// ============================================================================

async function fetchFromWoRMS(speciesName: string): Promise<TaxonomyResult | null> {
  try {
    // Clean species name by removing parenthetical rank indicators (sp.), (gen.), etc.
    const cleanedName = cleanSpeciesNameForLookup(speciesName);

    // Search for species by name
    const searchUrl = `${WORMS_BASE_URL}/AphiaRecordsByName/${encodeURIComponent(cleanedName)}?marine_only=false`;
    console.log(`🔍 WoRMS lookup: "${speciesName}" → "${cleanedName}"`);
    const response = await fetchWithTimeout(searchUrl);

    if (!response.ok) {
      console.log(`⚠️ WoRMS returned ${response.status} for: ${speciesName}`);
      return null;
    }

    const records: WoRMSRecord[] = await response.json();
    if (!records || records.length === 0) {
      console.log(`❌ WoRMS: No records found for: ${speciesName}`);
      return null;
    }

    // Find accepted name (prefer accepted over unaccepted)
    const acceptedRecord = records.find(r => r.status === 'accepted') || records[0];

    // Get full classification
    const classification = await getWoRMSClassification(acceptedRecord.AphiaID);

    // Parse common names
    const commonNames: string[] = [];
    if (acceptedRecord.vernaculars && acceptedRecord.vernaculars.length > 0) {
      commonNames.push(...acceptedRecord.vernaculars.map(v => v.vernacular));
    }

    // Determine confidence based on match type and status
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (acceptedRecord.status === 'accepted' && acceptedRecord.match_type === 'exact') {
      confidence = 'high';
    } else if (acceptedRecord.status !== 'accepted' || acceptedRecord.match_type === 'phonetic') {
      confidence = 'low';
    }

    const result: TaxonomyResult = {
      source: 'worms',
      scientificName: acceptedRecord.scientificname,
      rank: acceptedRecord.rank?.toLowerCase() || 'unknown',
      taxonId: acceptedRecord.AphiaID.toString(),
      commonNames: commonNames.slice(0, 3), // Limit to 3 common names
      hierarchy: classification,
      confidence,
      matchType: acceptedRecord.match_type === 'exact' ? 'exact' : 'fuzzy'
    };

    console.log(`✅ ${acceptedRecord.scientificname} (WoRMS)`);
    return result;

  } catch (error) {
    // WoRMS failure - log the error type for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout');
    console.log(`⚠️ WoRMS ${isTimeout ? 'TIMEOUT' : 'ERROR'} for ${speciesName}: ${errorMessage}`);
    return null;
  }
}

async function getWoRMSClassification(aphiaId: number): Promise<TaxonomicHierarchy> {
  try {
    const url = `${WORMS_BASE_URL}/AphiaClassificationByAphiaID/${aphiaId}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      return {};
    }

    const data: WoRMSClassification = await response.json();

    // Build hierarchy by traversing the nested structure
    const hierarchy: TaxonomicHierarchy = {};

    function traverse(node: WoRMSClassification | null | undefined) {
      if (!node) return;

      const rank = node.rank?.toLowerCase();
      const name = node.scientificname;

      if (rank && name) {
        switch (rank) {
          case 'kingdom':
            hierarchy.kingdom = name;
            break;
          case 'phylum':
            hierarchy.phylum = name;
            break;
          case 'class':
            hierarchy.class = name;
            break;
          case 'order':
            hierarchy.order = name;
            break;
          case 'family':
            hierarchy.family = name;
            break;
          case 'genus':
            hierarchy.genus = name;
            break;
          case 'species':
            hierarchy.species = name;
            break;
        }
      }

      // Recurse to parent (WoRMS returns parent as the containing object)
      if (node.child === null || node.child === undefined) {
        // This is the deepest child, we're done
        return;
      }
    }

    // Start from root and traverse down
    let current: WoRMSClassification | null = data;
    const nodes: WoRMSClassification[] = [];

    while (current) {
      nodes.push(current);
      current = current.child as WoRMSClassification | null;
    }

    // Process nodes to extract hierarchy
    nodes.forEach(node => {
      const rank = node.rank?.toLowerCase();
      const name = node.scientificname;

      if (rank && name) {
        switch (rank) {
          case 'kingdom':
            hierarchy.kingdom = name;
            break;
          case 'phylum':
            hierarchy.phylum = name;
            break;
          case 'class':
            hierarchy.class = name;
            break;
          case 'order':
            hierarchy.order = name;
            break;
          case 'family':
            hierarchy.family = name;
            break;
          case 'genus':
            hierarchy.genus = name;
            break;
          case 'species':
            hierarchy.species = name;
            break;
        }
      }
    });

    return hierarchy;

  } catch (error) {
    return {};
  }
}

// ============================================================================
// GBIF API Functions
// ============================================================================

async function fetchFromGBIF(speciesName: string): Promise<TaxonomyResult | null> {
  try {
    // Clean species name by removing parenthetical rank indicators (sp.), (gen.), etc.
    const cleanedName = cleanSpeciesNameForLookup(speciesName);

    // Use GBIF species match endpoint
    const searchUrl = `${GBIF_BASE_URL}/species/match?name=${encodeURIComponent(cleanedName)}&verbose=true`;
    const response = await fetchWithTimeout(searchUrl);

    if (!response.ok) return null;

    const match: GBIFMatch = await response.json();
    if (!match.usageKey) return null;

    // Reject HIGHERRANK matches - these return the wrong taxonId (e.g., kingdom instead of genus)
    // This happens when GBIF can't find an exact match and returns a higher taxonomic level
    if (match.matchType === 'HIGHERRANK') {
      console.log(`⚠️ ${cleanedName} - GBIF returned HIGHERRANK match (${match.rank}), skipping taxonId`);
      // Still return the result for hierarchy info, but without a valid taxonId
      const hierarchy: TaxonomicHierarchy = {
        kingdom: match.kingdom,
        phylum: match.phylum,
        class: match.class,
        order: match.order,
        family: match.family,
        genus: match.genus,
        species: match.species
      };

      return {
        source: 'gbif',
        scientificName: cleanedName, // Use the original name, not the higher rank match
        rank: 'unknown', // Don't trust the rank from a HIGHERRANK match
        taxonId: '', // Empty taxonId - will trigger search instead of direct link
        commonNames: [],
        hierarchy,
        confidence: 'low',
        matchType: 'fuzzy'
      };
    }

    // Build hierarchy from match response
    const hierarchy: TaxonomicHierarchy = {
      kingdom: match.kingdom,
      phylum: match.phylum,
      class: match.class,
      order: match.order,
      family: match.family,
      genus: match.genus,
      species: match.species
    };

    // Parse common names
    const commonNames: string[] = [];
    if (match.vernacularName) {
      commonNames.push(match.vernacularName);
    }

    // Determine confidence based on match type and GBIF confidence score
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (match.matchType === 'EXACT' && match.confidence >= 95) {
      confidence = 'high';
    } else if (match.matchType === 'FUZZY' || match.confidence < 80) {
      confidence = 'low';
    }

    const result: TaxonomyResult = {
      source: 'gbif',
      scientificName: match.scientificName,
      rank: match.rank?.toLowerCase() || 'unknown',
      taxonId: match.usageKey.toString(),
      commonNames,
      hierarchy,
      confidence,
      matchType: match.matchType === 'EXACT' ? 'exact' : 'fuzzy'
    };

    console.log(`✅ ${match.scientificName} (GBIF)`);
    return result;

  } catch (error) {
    // GBIF failure means species couldn't be resolved
    return null;
  }
}

// ============================================================================
// Main Lookup Functions
// ============================================================================

/**
 * Look up taxonomic information for a single species
 * Priority: Database → localStorage → GBIF API → WoRMS API (optional fallback)
 *
 * @param speciesName - The species name to look up
 * @param useWormsFallback - Whether to try WoRMS if GBIF fails (default: true)
 *                           Set to false for eDNA lookups since WoRMS doesn't provide
 *                           georeferenced sightings data
 */
export async function lookupSpeciesTaxonomy(
  speciesName: string,
  useWormsFallback: boolean = true
): Promise<TaxonomyResult | null> {
  if (!speciesName || speciesName.trim() === '') {
    return null;
  }

  // 1. Check database first (permanent storage)
  const dbResult = await getTaxonomyFromDB(speciesName);
  if (dbResult) {
    return dbResult;
  }

  // 2. Check localStorage cache (7-day expiry, fallback)
  const cached = getCachedTaxonomy(speciesName);
  if (cached) {
    // Save to database for permanent storage
    await saveTaxonomyToDB(speciesName, cached);
    return cached;
  }

  // 3. Try GBIF API first (comprehensive database that includes WoRMS data)
  let result = await fetchFromGBIF(speciesName);

  // 4. Fallback to WoRMS API if GBIF fails and fallback is enabled
  // Note: WoRMS fallback is disabled for eDNA since it doesn't provide georeferenced sightings
  if (!result && useWormsFallback) {
    result = await fetchFromWoRMS(speciesName);
  }

  // Save result to both database and localStorage
  if (result) {
    await saveTaxonomyToDB(speciesName, result);
    setCachedTaxonomy(speciesName, result);
  }

  return result;
}

/**
 * Look up taxonomy for multiple species with concurrency control
 * Returns a Map of species name -> TaxonomyResult
 *
 * @param speciesNames - Array of species names to look up
 * @param maxConcurrent - Maximum concurrent API requests (default: 5)
 * @param onProgress - Optional progress callback
 * @param useWormsFallback - Whether to try WoRMS if GBIF fails (default: true)
 *                           Set to false for eDNA lookups
 */
export async function lookupSpeciesBatch(
  speciesNames: string[],
  maxConcurrent: number = MAX_CONCURRENT_REQUESTS,
  onProgress?: (current: number, total: number) => void,
  useWormsFallback: boolean = true
): Promise<Map<string, TaxonomyResult>> {
  const results = new Map<string, TaxonomyResult>();

  // Remove empty strings and duplicates
  const uniqueSpecies = [...new Set(speciesNames.filter(s => s && s.trim() !== ''))];

  // Check cache first
  const uncachedSpecies: string[] = [];
  for (const species of uniqueSpecies) {
    const cached = getCachedTaxonomy(species);
    if (cached) {
      results.set(species, cached);
    } else {
      uncachedSpecies.push(species);
    }
  }

  console.log(`🔬 Taxonomy lookup: ${uniqueSpecies.length} species (${results.size} cached, ${uncachedSpecies.length} new)`);

  if (uncachedSpecies.length === 0) {
    return results;
  }

  // Batch fetch with concurrency limit
  const chunks = chunkArray(uncachedSpecies, maxConcurrent);
  let processedCount = results.size;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const promises = chunk.map(async (species) => {
      try {
        const result = await lookupSpeciesTaxonomy(species, useWormsFallback);
        if (result) {
          results.set(species, result);
        }
      } catch (error) {
        // Species lookup failed - continue with next
      }

      processedCount++;
      if (onProgress) {
        onProgress(processedCount, uniqueSpecies.length);
      }
    });

    await Promise.all(promises);
  }

  console.log(`✅ Taxonomy complete: ${results.size}/${uniqueSpecies.length} resolved`);

  return results;
}

/**
 * Get taxonomy rank abbreviation (sp./gen./fam./ord./class./phyl.)
 */
export function getTaxonomyRankAbbreviation(rank: string): string {
  const rankMap: Record<string, string> = {
    'species': 'sp.',
    'genus': 'gen.',
    'family': 'fam.',
    'order': 'ord.',
    'class': 'class.',
    'phylum': 'phyl.',
    'kingdom': 'king.'
  };

  return rankMap[rank.toLowerCase()] || rank;
}

/**
 * Clear the taxonomy cache (useful for debugging or forced refresh)
 */
export { clearTaxonomyCache };
