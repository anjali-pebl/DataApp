/**
 * Taxonomic Tree Builder
 *
 * Builds a hierarchical tree structure from flat species data with WoRMS/GBIF taxonomy
 */

import type { HaplotypeCellData } from '@/components/pin-data/csvParser';

export interface TreeNode {
  name: string; // Always use cleaned name (no rank annotations like "(gen.)" or "(fam.)")
  originalName?: string; // Original CSV name if it had rank annotation
  rank: 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species' | 'unknown';
  children: TreeNode[];
  speciesCount: number; // Number of unique species under this node
  siteOccurrences?: Map<string, number>; // For species nodes: site -> haplotype count
  isLeaf: boolean; // True if this is a leaf node (species or higher-order entry without children)
  csvEntry: boolean; // True if this entry exists directly in the CSV file
  confidence?: 'high' | 'medium' | 'low'; // Taxonomy confidence for species nodes
  source?: 'worms' | 'gbif' | 'unknown'; // Taxonomy source for species nodes
  taxonId?: string; // AphiaID (WoRMS) or usageKey (GBIF) for direct linking
}

interface TaxonomicHierarchy {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

/**
 * Build a taxonomic tree from haplotype cell data
 */
export function buildTaxonomicTree(
  data: HaplotypeCellData[]
): TreeNode {
  // Root node
  const root: TreeNode = {
    name: 'Life',
    rank: 'unknown',
    children: [],
    speciesCount: 0,
    isLeaf: false,
    csvEntry: false
  };

  // Group data by species to get unique species with their hierarchy
  const speciesMap = new Map<string, {
    hierarchy: TaxonomicHierarchy;
    sites: Map<string, number>;
    confidence?: 'high' | 'medium' | 'low';
    source?: 'worms' | 'gbif' | 'unknown';
    taxonId?: string;
    taxonomyRank?: string; // From API: sp./gen./fam./ord./class./phyl.
  }>();

  data.forEach(cell => {
    if (!speciesMap.has(cell.species)) {
      speciesMap.set(cell.species, {
        hierarchy: cell.metadata?.fullHierarchy || {},
        sites: new Map(),
        confidence: cell.metadata?.taxonomyConfidence,
        source: cell.metadata?.taxonomySource as 'worms' | 'gbif' | 'unknown' | undefined,
        taxonId: cell.metadata?.taxonId,
        taxonomyRank: cell.metadata?.taxonomyRank // e.g., 'sp.', 'gen.', 'fam.'
      });
    }

    const speciesData = speciesMap.get(cell.species)!;
    speciesData.sites.set(cell.site, (speciesData.sites.get(cell.site) || 0) + cell.count);
  });

  // Sort entries so complete hierarchies are processed FIRST
  // This ensures that when we process "Pholoe sp." (incomplete hierarchy),
  // "Pholoe baltica" (complete hierarchy) has already created the proper node
  const sortedEntries = Array.from(speciesMap.entries()).sort(([, a], [, b]) => {
    // Count how many hierarchy levels are filled
    const countHierarchy = (h: typeof a.hierarchy) => {
      let count = 0;
      if (h.kingdom) count++;
      if (h.phylum) count++;
      if (h.class) count++;
      if (h.order) count++;
      if (h.family) count++;
      if (h.genus) count++;
      if (h.species) count++;
      return count;
    };
    // More complete hierarchies first
    return countHierarchy(b.hierarchy) - countHierarchy(a.hierarchy);
  });

  // Build tree for each species (sorted by hierarchy completeness)
  sortedEntries.forEach(([speciesName, speciesData]) => {
    const { hierarchy, sites, confidence, source, taxonId, taxonomyRank } = speciesData;

    // Define taxonomic path from root to species
    const path: Array<{ name: string; rank: TreeNode['rank']; originalName?: string }> = [];

    // Clean species name by removing rank annotations like (gen.), (sp.), (fam.), (kingdom), (phylum), etc.
    // This allows proper matching with WoRMS/GBIF taxonomy data
    // Handles both abbreviated forms with dots: (sp.), (gen.), (fam.)
    // And full rank names without dots: (kingdom), (phylum), (order), (family), (genus), (species)
    // Also handles trailing "sp.", "spp." without parentheses (common in eDNA genus-level IDs)
    // Also handles double periods like "(sp.)." from SubCam data
    const cleanedSpeciesName = speciesName
      .replace(/\s*\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)\.?\s*$/i, '')  // (sp.). or (sp.)
      .replace(/\s*\((kingdom|phylum|order|family|genus|species)\)\.?\s*$/i, '')  // (species). or (species)
      .replace(/\s+(sp\.?|spp\.?|gen\.?|fam\.?|ord\.?|class\.?)$/i, '')  // Remove trailing rank abbrevs (eDNA style)
      .trim();

    // Extract rank annotation from CSV name as fallback
    // Parenthetical forms like "(sp.)" or "(sp.)." indicate species-level ID (SubCam style)
    // Trailing forms like "sp." indicate genus-level ID (eDNA style - unknown species within genus)
    const parentheticalMatch = speciesName.match(/\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)\.?$/i)  // handles (sp.) and (sp.).
      || speciesName.match(/\((kingdom|phylum|order|family|genus|species)\)\.?$/i);  // handles (species) and (species).
    const trailingRankMatch = speciesName.match(/\s+(sp|spp|gen|fam|ord|class)\.?$/i);

    // Determine the actual rank of this entry
    // Check if the cleaned species name matches any of the higher taxonomic levels
    let actualRank: TreeNode['rank'] = 'species';
    if (hierarchy.genus === cleanedSpeciesName) actualRank = 'genus';
    else if (hierarchy.family === cleanedSpeciesName) actualRank = 'family';
    else if (hierarchy.order === cleanedSpeciesName) actualRank = 'order';
    else if (hierarchy.class === cleanedSpeciesName) actualRank = 'class';
    else if (hierarchy.phylum === cleanedSpeciesName) actualRank = 'phylum';
    else if (hierarchy.kingdom === cleanedSpeciesName) actualRank = 'kingdom';
    // Fallback 1a: Parenthetical annotation like "(sp.)" - species-level ID (SubCam style)
    else if (parentheticalMatch) {
      const parentheticalRankMap: Record<string, TreeNode['rank']> = {
        'phyl': 'phylum',
        'gigaclass': 'class',
        'infraclass': 'class',
        'class': 'class',
        'ord': 'order',
        'fam': 'family',
        'gen': 'genus',
        'sp': 'species',  // "(sp.)" = species-level identification
        'kingdom': 'kingdom',
        'phylum': 'phylum',
        'order': 'order',
        'family': 'family',
        'genus': 'genus',
        'species': 'species'
      };
      actualRank = parentheticalRankMap[parentheticalMatch[1].toLowerCase()] || 'species';
    }
    // Fallback 1b: Trailing annotation like "sp." - genus-level ID (eDNA style)
    // "Gadus sp." means "unidentified species within genus Gadus" = genus-level ID
    else if (trailingRankMatch) {
      const trailingRankMap: Record<string, TreeNode['rank']> = {
        'sp': 'genus',   // "Gadus sp." = genus-level (unknown species within Gadus)
        'spp': 'genus',  // "Gadus spp." = genus-level (multiple species within Gadus)
      };
      actualRank = trailingRankMap[trailingRankMatch[1].toLowerCase()] || 'genus';
    }
    // Fallback 2: Use taxonomyRank from API metadata (for eDNA data without CSV annotations)
    else if (taxonomyRank) {
      const apiRankMap: Record<string, TreeNode['rank']> = {
        'sp.': 'species',
        'gen.': 'genus',
        'fam.': 'family',
        'ord.': 'order',
        'class.': 'class',
        'phyl.': 'phylum',
        'king.': 'kingdom'
      };
      actualRank = apiRankMap[taxonomyRank] || 'species';
    }

    // Debug: log rank determination for genus-level entries
    if (actualRank !== 'species') {
      console.log(`[TREE] "${speciesName}" → "${cleanedSpeciesName}" = ${actualRank.toUpperCase()}`);
    }

    // Special handling: If this is a higher-order entry (not species) with incomplete hierarchy,
    // search the tree for an existing node with same name+rank and adopt its parent path
    const isHigherOrderEntry = actualRank !== 'species';

    // Check for incomplete hierarchy - more comprehensive check:
    // For genus entries, we need at least family to place it correctly
    // If we only have kingdom but missing intermediate levels, that's incomplete
    // This commonly happens with HIGHERRANK matches (e.g., homonyms like "Pholoe" in both insects and worms)
    const hasIncompleteHierarchy = (() => {
      if (actualRank === 'genus') {
        // Genus needs at least family to be placed correctly
        return !hierarchy.family;
      } else if (actualRank === 'family') {
        return !hierarchy.order;
      } else if (actualRank === 'order') {
        return !hierarchy.class;
      } else if (actualRank === 'class') {
        return !hierarchy.phylum;
      } else if (actualRank === 'phylum') {
        return !hierarchy.kingdom;
      }
      // For other ranks, use original check
      return !hierarchy.kingdom && !hierarchy.phylum && !hierarchy.class;
    })();

    if (isHigherOrderEntry && hasIncompleteHierarchy) {
      // Search entire tree for existing matching node
      function findNodeInTree(node: TreeNode, targetName: string, targetRank: string): { node: TreeNode; parentPath: Array<{ name: string; rank: TreeNode['rank'] }> } | null {
        // Check direct children
        for (const child of node.children) {
          if (child.name === targetName && child.rank === targetRank) {
            // Found it! Build parent path
            const parentPath: Array<{ name: string; rank: TreeNode['rank'] }> = [];
            if (node.name !== 'Life') {
              parentPath.push({ name: node.name, rank: node.rank });
            }
            return { node: child, parentPath };
          }
          // Recursively search children
          const result = findNodeInTree(child, targetName, targetRank);
          if (result) {
            // Prepend current node to parent path
            if (node.name !== 'Life') {
              result.parentPath.unshift({ name: node.name, rank: node.rank });
            }
            return result;
          }
        }
        return null;
      }

      const existingNode = findNodeInTree(root, cleanedSpeciesName, actualRank);
      if (existingNode) {
        // Adopt the parent path from existing node
        path.push(...existingNode.parentPath);
      } else {
        // No existing node found - infer minimal hierarchy based on rank
        // For animals, assume Animalia kingdom
        if (actualRank === 'phylum' || actualRank === 'class') {
          path.push({ name: 'Animalia', rank: 'kingdom' });
        }
      }
    } else {
      // Build path up to (but not including) the actual rank
      // Use cleanedSpeciesName for comparison to avoid duplicate entries
      if (actualRank !== 'kingdom' && hierarchy.kingdom && hierarchy.kingdom !== cleanedSpeciesName) {
        path.push({ name: hierarchy.kingdom, rank: 'kingdom' });
      }
      if (actualRank !== 'phylum' && hierarchy.phylum && hierarchy.phylum !== cleanedSpeciesName) {
        path.push({ name: hierarchy.phylum, rank: 'phylum' });
      }
      if (actualRank !== 'class' && hierarchy.class && hierarchy.class !== cleanedSpeciesName) {
        path.push({ name: hierarchy.class, rank: 'class' });
      }
      if (actualRank !== 'order' && hierarchy.order && hierarchy.order !== cleanedSpeciesName) {
        path.push({ name: hierarchy.order, rank: 'order' });
      }
      if (actualRank !== 'family' && hierarchy.family && hierarchy.family !== cleanedSpeciesName) {
        path.push({ name: hierarchy.family, rank: 'family' });
      }
      if (actualRank !== 'genus' && hierarchy.genus && hierarchy.genus !== cleanedSpeciesName) {
        path.push({ name: hierarchy.genus, rank: 'genus' });
      }
    }

    // Add the entry itself at its actual rank
    // Store originalName for internal matching (parameterStates keys use original names)
    // Display components should use node.name (cleaned) for rendering
    path.push({
      name: cleanedSpeciesName,
      rank: actualRank,
      originalName: speciesName !== cleanedSpeciesName ? speciesName : undefined
    });

    // Insert into tree
    let currentNode = root;

    for (let i = 0; i < path.length; i++) {
      const pathItem = path[i];
      const { name, rank, originalName } = pathItem;
      const isLeafNode = i === path.length - 1; // Last item in path is the actual CSV entry

      // Find existing node by cleaned name and rank
      let childNode = currentNode.children.find(child => child.name === name && child.rank === rank);

      if (!childNode) {
        // Create new node
        childNode = {
          name, // cleaned name
          rank,
          children: [],
          speciesCount: 0,
          isLeaf: isLeafNode,
          csvEntry: isLeafNode, // Mark as CSV entry if it's the leaf
          ...(originalName && { originalName }),
          ...(isLeafNode && { siteOccurrences: sites, confidence, source, taxonId })
        };
        currentNode.children.push(childNode);
      } else {
        // Node exists (created as parent from WoRMS/GBIF hierarchy)
        // Now we're adding it as a CSV entry - merge the data
        if (isLeafNode) {
          childNode.csvEntry = true; // Mark that this also exists in CSV
          childNode.isLeaf = true; // Upgrade to leaf status
          childNode.siteOccurrences = sites;
          childNode.confidence = confidence;
          childNode.source = source;
          childNode.taxonId = taxonId;
          if (originalName) {
            childNode.originalName = originalName;
          }
        }
      }

      // Update species count (propagate up the tree)
      if (isLeafNode) {
        childNode.speciesCount = 1;
      }

      currentNode = childNode;
    }
  });

  // Recursively calculate species counts for all nodes
  function calculateSpeciesCounts(node: TreeNode): number {
    if (node.isLeaf) {
      return 1; // Species node counts as 1
    }

    let totalSpecies = 0;
    node.children.forEach(child => {
      totalSpecies += calculateSpeciesCounts(child);
    });

    node.speciesCount = totalSpecies;
    return totalSpecies;
  }

  calculateSpeciesCounts(root);

  // Sort children: prioritize complete chains (taxa with data AND children with data),
  // then by rank (higher ranks first), then alphabetically
  const rankOrder: Record<string, number> = {
    'kingdom': 0, 'phylum': 1, 'class': 2, 'order': 3,
    'family': 4, 'genus': 5, 'species': 6, 'unknown': 7
  };

  // Helper: check if a node or any descendant has csvEntry (actual data in heatmap)
  function hasDescendantWithData(node: TreeNode): boolean {
    if (node.csvEntry) return true;
    return node.children.some(child => hasDescendantWithData(child));
  }

  function sortTreeNodes(node: TreeNode) {
    // Debug: log before/after for nodes with multiple children
    const beforeSort = node.children.map(c => {
      const hasData = c.csvEntry;
      const hasDataKids = c.children.some(child => hasDescendantWithData(child));
      return `${c.name}(${c.rank},data=${hasData},dataKids=${hasDataKids})`;
    });

    node.children.sort((a, b) => {
      // Check data status - based on csvEntry (actual heatmap data), not just tree structure
      const aHasData = a.csvEntry;
      const bHasData = b.csvEntry;
      const aHasDataChildren = a.children.some(c => hasDescendantWithData(c));
      const bHasDataChildren = b.children.some(c => hasDescendantWithData(c));

      // Primary: complete chains (this node has data AND has children with data) come first
      const aIsCompleteChain = aHasData && aHasDataChildren;
      const bIsCompleteChain = bHasData && bHasDataChildren;
      if (aIsCompleteChain !== bIsCompleteChain) {
        return aIsCompleteChain ? -1 : 1;
      }

      // Secondary: taxa with children that have data (even if this node doesn't have data)
      if (aHasDataChildren !== bHasDataChildren) {
        return aHasDataChildren ? -1 : 1;
      }

      // Tertiary: taxa that have data themselves (leaf nodes with data)
      if (aHasData !== bHasData) {
        return aHasData ? -1 : 1;
      }

      // Quaternary: sort by rank (higher ranks first)
      const rankA = rankOrder[a.rank] ?? 7;
      const rankB = rankOrder[b.rank] ?? 7;
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      // Quinary: alphabetical within same rank
      return a.name.localeCompare(b.name);
    });

    const afterSort = node.children.map(c => {
      const hasData = c.csvEntry;
      const hasDataKids = c.children.some(child => hasDescendantWithData(child));
      return `${c.name}(${c.rank},data=${hasData},dataKids=${hasDataKids})`;
    });
    if (node.children.length > 1) {
      const changed = beforeSort.join(',') !== afterSort.join(',');
      console.log(`[TREE SORT] "${node.name}" (${node.rank}) children${changed ? ' REORDERED' : ''}:`, afterSort);
    }

    node.children.forEach(sortTreeNodes);
  }

  sortTreeNodes(root);

  return root;
}

/**
 * Get display color for taxonomic rank (Paul Tol colorblind-friendly palette)
 */
export function getRankColor(rank: TreeNode['rank']): string {
  const colorMap: Record<TreeNode['rank'], string> = {
    kingdom: '#882255', // Wine
    phylum: '#AA3377',  // Purple
    class: '#EE6677',   // Red/pink
    order: '#CCBB44',   // Olive yellow
    family: '#228833',  // Green
    genus: '#66CCEE',   // Cyan
    species: '#4477AA', // Blue
    unknown: '#BBBBBB'  // Grey
  };

  return colorMap[rank];
}

/**
 * Get indentation level for rank
 */
export function getRankIndentation(rank: TreeNode['rank']): number {
  const indentMap: Record<TreeNode['rank'], number> = {
    kingdom: 0,
    phylum: 1,
    class: 2,
    order: 3,
    family: 4,
    genus: 5,
    species: 6,
    unknown: 0
  };

  return indentMap[rank] * 20; // 20px per level
}

/**
 * Flattened taxon for linear heatmap display
 */
export interface FlattenedTaxon {
  name: string;
  rank: TreeNode['rank'];
  indentLevel: number;
  path: string[]; // Full lineage path
  node: TreeNode; // Reference to original tree node
}

/**
 * Flatten taxonomic tree into linear list for heatmap Y-axis
 * Uses depth-first traversal to preserve hierarchical relationships
 */
export function flattenTreeForHeatmap(tree: TreeNode): FlattenedTaxon[] {
  const result: FlattenedTaxon[] = [];

  // Map taxonomic rank to absolute indent level (matching HeatmapDisplay.tsx:111-120)
  const rankToIndentLevel = (rank: TreeNode['rank']): number => {
    const rankLevels: Record<string, number> = {
      'kingdom': 0,
      'phylum': 0,
      'class': 2,
      'order': 3,
      'family': 4,
      'genus': 5,
      'species': 6,
      'unknown': 0
    };
    return rankLevels[rank] || 0;
  };

  function traverse(node: TreeNode, path: string[]) {
    // Skip artificial root node
    if (node.name !== 'Life' && node.name !== 'Root') {
      result.push({
        name: node.name,
        rank: node.rank,
        indentLevel: rankToIndentLevel(node.rank), // Use rank-based indent, not tree depth
        path: [...path, node.name],
        node: node
      });
    }

    // Children are already sorted alphabetically from buildTaxonomicTree
    // Recursively traverse in depth-first order
    for (const child of node.children) {
      const nextPath = node.name === 'Life' || node.name === 'Root' ? path : [...path, node.name];
      traverse(child, nextPath);
    }
  }

  traverse(tree, []);
  return result;
}
