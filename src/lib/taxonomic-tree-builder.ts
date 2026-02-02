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
  }>();

  data.forEach(cell => {
    if (!speciesMap.has(cell.species)) {
      speciesMap.set(cell.species, {
        hierarchy: cell.metadata?.fullHierarchy || {},
        sites: new Map(),
        confidence: cell.metadata?.taxonomyConfidence,
        source: cell.metadata?.taxonomySource as 'worms' | 'gbif' | 'unknown' | undefined
      });
    }

    const speciesData = speciesMap.get(cell.species)!;
    speciesData.sites.set(cell.site, (speciesData.sites.get(cell.site) || 0) + cell.count);
  });

  // Build tree for each species
  speciesMap.forEach((speciesData, speciesName) => {
    const { hierarchy, sites, confidence, source } = speciesData;

    // Define taxonomic path from root to species
    const path: Array<{ name: string; rank: TreeNode['rank']; originalName?: string }> = [];

    // Clean species name by removing rank annotations like (gen.), (sp.), (fam.), (kingdom), (phylum), etc.
    // This allows proper matching with WoRMS/GBIF taxonomy data
    // Handles both abbreviated forms with dots: (sp.), (gen.), (fam.)
    // And full rank names without dots: (kingdom), (phylum), (order), (family), (genus), (species)
    const cleanedSpeciesName = speciesName
      .replace(/\s*\((phyl|infraclass|class|ord|fam|gen|sp)\.\)\s*$/i, '')
      .replace(/\s*\((kingdom|phylum|order|family|genus|species)\)\s*$/i, '')
      .trim();

    // Extract rank annotation from CSV name as fallback
    // Handles both abbreviated: (phyl.), (sp.) and full: (kingdom), (phylum)
    const rankAnnotationMatch = speciesName.match(/\((phyl|infraclass|class|ord|fam|gen|sp)\.\)$/i)
      || speciesName.match(/\((kingdom|phylum|order|family|genus|species)\)$/i);
    const csvRankHint = rankAnnotationMatch ? rankAnnotationMatch[1].toLowerCase() : null;

    // Determine the actual rank of this entry
    // Check if the cleaned species name matches any of the higher taxonomic levels
    let actualRank: TreeNode['rank'] = 'species';
    if (hierarchy.genus === cleanedSpeciesName) actualRank = 'genus';
    else if (hierarchy.family === cleanedSpeciesName) actualRank = 'family';
    else if (hierarchy.order === cleanedSpeciesName) actualRank = 'order';
    else if (hierarchy.class === cleanedSpeciesName) actualRank = 'class';
    else if (hierarchy.phylum === cleanedSpeciesName) actualRank = 'phylum';
    else if (hierarchy.kingdom === cleanedSpeciesName) actualRank = 'kingdom';
    // Fallback: If hierarchy matching failed, use CSV rank annotation
    else if (csvRankHint) {
      const rankMap: Record<string, TreeNode['rank']> = {
        // Abbreviated forms
        'phyl': 'phylum',
        'infraclass': 'class',
        'class': 'class',
        'ord': 'order',
        'fam': 'family',
        'gen': 'genus',
        'sp': 'species',
        // Full rank names
        'kingdom': 'kingdom',
        'phylum': 'phylum',
        'order': 'order',
        'family': 'family',
        'genus': 'genus',
        'species': 'species'
      };
      actualRank = rankMap[csvRankHint] || 'species';
    }

    // Special handling: If this is a higher-order entry (not species) with incomplete hierarchy,
    // search the tree for an existing node with same name+rank and adopt its parent path
    const isHigherOrderEntry = actualRank !== 'species';
    const hasIncompleteHierarchy = !hierarchy.kingdom && !hierarchy.phylum && !hierarchy.class;

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
    // Use cleaned name for matching, preserve original name if it had annotation
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
          ...(isLeafNode && { siteOccurrences: sites, confidence, source })
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

  // Sort children alphabetically at each level
  function sortTreeNodes(node: TreeNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
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
