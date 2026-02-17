/**
 * Taxonomic Reorganization Service
 *
 * Intelligently reorganizes taxonomic data from CSV files to display
 * proper hierarchical relationships in the heatmap without modifying
 * the source data.
 */

export interface TaxonomicEntry {
  originalName: string;  // Full name with rank suffix
  cleanName: string;     // Name without rank suffix
  rank: string | null;   // Rank (phyl, infraclass, class, ord, fam, gen, sp)
  parent: string | null; // Original name of parent taxon
  children: string[];    // Original names of child taxa
}

export interface ReorganizationResult {
  orderedNames: string[];  // Reorganized order of taxon names
  relationships: Map<string, TaxonomicEntry>;
}

/**
 * Extract taxonomic rank from species name
 */
function extractRank(name: string): string | null {
  const match = name.match(/\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)/);
  return match ? match[1] : null;
}

/**
 * Remove rank suffix from name
 */
function stripRankSuffix(name: string): string {
  return name.replace(/\s*\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)\s*$/, '').trim();
}

/**
 * Get hierarchical level for sorting
 */
function getRankLevel(rank: string | null): number {
  const levels: Record<string, number> = {
    'phyl': 0,
    'gigaclass': 1,
    'infraclass': 1,
    'class': 2,
    'ord': 3,
    'fam': 4,
    'gen': 5,
    'sp': 6
  };
  return rank ? (levels[rank] ?? 99) : 99;
}

/**
 * Detect parent-child relationship between two taxa
 * Returns true if child should be nested under parent
 */
function isDirectParentChild(
  parentName: string,
  parentRank: string | null,
  childName: string,
  childRank: string | null
): boolean {
  if (!parentRank || !childRank) return false;

  const parentLevel = getRankLevel(parentRank);
  const childLevel = getRankLevel(childRank);

  // Child must be exactly one level below parent
  if (childLevel !== parentLevel + 1) return false;

  // For species → genus: first word must match genus name
  if (childRank === 'sp' && parentRank === 'gen') {
    const childFirstWord = childName.split(' ')[0];
    return childFirstWord === parentName;
  }

  // For genus → family: check if genus name is contained in or similar to family
  // This is heuristic-based and may not always be accurate
  if (childRank === 'gen' && parentRank === 'fam') {
    // Family names often end in -idae, -aceae, etc.
    // Genus might be in the family name (e.g., Gadidae contains Gadus)
    const familyStem = parentName.replace(/(idae|aceae|inae)$/i, '');
    return childName.toLowerCase().includes(familyStem.toLowerCase()) ||
           familyStem.toLowerCase().includes(childName.toLowerCase());
  }

  // For other ranks, we can't reliably determine without external taxonomic data
  // So we'll use proximity in the original list as a hint
  return false;
}

/**
 * Build taxonomic relationships from a list of taxon names
 */
function buildRelationships(taxonNames: string[]): Map<string, TaxonomicEntry> {
  const entries = new Map<string, TaxonomicEntry>();

  // First pass: create entries for all taxa
  taxonNames.forEach(name => {
    const rank = extractRank(name);
    const cleanName = stripRankSuffix(name);

    entries.set(name, {
      originalName: name,
      cleanName,
      rank,
      parent: null,
      children: []
    });
  });

  // Second pass: detect parent-child relationships
  taxonNames.forEach((childName, childIndex) => {
    const childEntry = entries.get(childName);
    if (!childEntry || !childEntry.rank) return;

    // Look backwards for potential parent
    for (let i = childIndex - 1; i >= 0; i--) {
      const potentialParentName = taxonNames[i];
      const parentEntry = entries.get(potentialParentName);
      if (!parentEntry || !parentEntry.rank) continue;

      const parentLevel = getRankLevel(parentEntry.rank);
      const childLevel = getRankLevel(childEntry.rank);

      // Check if this could be the direct parent
      if (childLevel === parentLevel + 1) {
        // Use name-based matching for reliable relationships
        if (isDirectParentChild(
          parentEntry.cleanName,
          parentEntry.rank,
          childEntry.cleanName,
          childEntry.rank
        )) {
          childEntry.parent = potentialParentName;
          parentEntry.children.push(childName);
          break; // Found parent, stop searching
        }
      } else if (childLevel > parentLevel + 1) {
        // Could be a grandparent or higher, keep looking
        continue;
      } else {
        // Went past potential parent level, stop
        break;
      }
    }
  });

  console.log('[Taxonomic Reorganizer] Built relationships:', {
    totalTaxa: entries.size,
    withParents: Array.from(entries.values()).filter(e => e.parent).length,
    withChildren: Array.from(entries.values()).filter(e => e.children.length > 0).length
  });

  return entries;
}

/**
 * Reorganize taxa into hierarchical order
 */
function reorganizeHierarchically(
  relationships: Map<string, TaxonomicEntry>
): string[] {
  const result: string[] = [];
  const processed = new Set<string>();

  /**
   * Recursively add taxon and its children
   */
  function addTaxonAndDescendants(taxonName: string) {
    if (processed.has(taxonName)) return;

    result.push(taxonName);
    processed.add(taxonName);

    const entry = relationships.get(taxonName);
    if (!entry) return;

    // Add children in alphabetical order (by clean name)
    const sortedChildren = [...entry.children].sort((a, b) => {
      const aClean = relationships.get(a)?.cleanName || a;
      const bClean = relationships.get(b)?.cleanName || b;
      return aClean.localeCompare(bClean);
    });

    sortedChildren.forEach(childName => {
      addTaxonAndDescendants(childName);
    });
  }

  // Find top-level taxa (those without parents) and sort them
  const topLevel = Array.from(relationships.keys())
    .filter(name => !relationships.get(name)?.parent)
    .sort((a, b) => {
      const aEntry = relationships.get(a);
      const bEntry = relationships.get(b);

      // Sort by rank first, then alphabetically
      const aLevel = getRankLevel(aEntry?.rank || null);
      const bLevel = getRankLevel(bEntry?.rank || null);

      if (aLevel !== bLevel) return aLevel - bLevel;

      return (aEntry?.cleanName || a).localeCompare(bEntry?.cleanName || b);
    });

  // Process each top-level taxon and its descendants
  topLevel.forEach(taxonName => {
    addTaxonAndDescendants(taxonName);
  });

  return result;
}

/**
 * Main function: reorganize taxonomic names from CSV
 */
export function reorganizeTaxonomicData(
  originalTaxonNames: string[]
): ReorganizationResult {
  console.log('[Taxonomic Reorganizer] Starting reorganization...');
  console.log('[Taxonomic Reorganizer] Input taxa:', originalTaxonNames.length);

  // Build parent-child relationships
  const relationships = buildRelationships(originalTaxonNames);

  // Reorganize into hierarchical order
  const orderedNames = reorganizeHierarchically(relationships);

  console.log('[Taxonomic Reorganizer] Reorganization complete');
  console.log('[Taxonomic Reorganizer] Output order:', orderedNames);

  // Log detected lineages for debugging
  const lineages = Array.from(relationships.values())
    .filter(e => e.parent)
    .map(e => `${e.parent} → ${e.originalName}`);

  if (lineages.length > 0) {
    console.log('[Taxonomic Reorganizer] Detected lineages:', lineages);
  }

  return {
    orderedNames,
    relationships
  };
}
