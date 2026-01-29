"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Edit, Info } from 'lucide-react';
import type { TreeNode } from '@/lib/taxonomic-tree-builder';
import { getRankColor, getRankIndentation } from '@/lib/taxonomic-tree-builder';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface TaxonomicTreeViewProps {
  tree: TreeNode;
  containerHeight: number;
  onSpeciesClick?: (speciesName: string) => void;
  highlightedTaxon?: string | null;
}

interface TreeNodeComponentProps {
  node: TreeNode;
  level: number;
  onSpeciesClick?: (speciesName: string) => void;
  highlightedTaxon?: string | null;
}

function TreeNodeComponent({ node, level, onSpeciesClick, highlightedTaxon }: TreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(true); // Auto-expand entire tree to show all species

  const hasChildren = node.children.length > 0;
  // Compact indentation for hierarchical display
  const baseIndent = level * 12;
  const indentation = node.rank === 'species' ? baseIndent + 8 : baseIndent;

  // Check if this entry exists in CSV (either as leaf or marked with csvEntry flag)
  const isCSVEntry = node.csvEntry;

  // Detect unrecognized species (not found in WoRMS/GBIF database)
  // Only apply to actual species (rank === 'species'), not to higher-level taxa that happen to be leaf nodes
  const isUnrecognizedSpecies = node.rank === 'species' && node.isLeaf && (
    !node.source ||
    node.source === 'unknown'
  );

  // Calculate total haplotype count for species nodes
  const totalHaplotypes = useMemo(() => {
    if (!node.siteOccurrences) return 0;
    return Array.from(node.siteOccurrences.values()).reduce((sum, count) => sum + count, 0);
  }, [node.siteOccurrences]);

  // Get confidence color
  const getConfidenceColor = (confidence?: 'high' | 'medium' | 'low') => {
    if (!confidence) return '#9ca3af'; // gray-400
    switch (confidence) {
      case 'high': return '#10b981'; // green-500
      case 'medium': return '#f59e0b'; // amber-500
      case 'low': return '#ef4444'; // red-500
      default: return '#9ca3af';
    }
  };

  const nodeName = node.originalName || node.name;
  const isHighlighted = highlightedTaxon === nodeName;

  return (
    <div className="font-mono text-[10px] leading-tight">
      {/* Current Node */}
      <div
        data-taxon-name={nodeName}
        className={cn(
          "flex items-center gap-1 py-0 px-1 hover:bg-gray-100 rounded cursor-pointer transition-colors",
          // CSV entry nodes: emerald background, full opacity
          isCSVEntry && "bg-emerald-50 opacity-100",
          // Parent-only nodes (not in CSV): semi-transparent
          !isCSVEntry && "opacity-25",
          // Highlighted taxon from heatmap "Show in Tree"
          isHighlighted && "!bg-yellow-200 !opacity-100 ring-2 ring-yellow-400 rounded"
        )}
        style={{ paddingLeft: `${indentation + 4}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse Icon */}
        <div className="w-3 h-3 flex items-center justify-center flex-shrink-0">
          {hasChildren && (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            )
          )}
        </div>

        {/* Rank Badge */}
        <span
          className="text-[8px] font-bold px-1 py-0 rounded uppercase flex-shrink-0 leading-tight"
          style={{
            backgroundColor: getRankColor(node.rank),
            color: 'white',
            minWidth: '12px',
            textAlign: 'center'
          }}
        >
          {node.rank === 'unknown' ? '?' : node.rank.charAt(0)}
        </span>

        {/* Node Name */}
        <span
          className={cn(
            "flex-1 truncate",
            // CSV entry nodes: emerald color, bold
            isCSVEntry && "font-semibold text-emerald-700",
            // Non-CSV nodes: gray
            !isCSVEntry && "text-gray-700",
            // ALL CSV entry nodes are clickable
            isCSVEntry && "cursor-pointer hover:bg-gray-200/50 px-1 rounded transition-colors",
            // Unrecognized species: special underline styling
            isUnrecognizedSpecies && "underline decoration-orange-500 decoration-2"
          )}
          onClick={(e) => {
            if (isCSVEntry && onSpeciesClick) {
              e.stopPropagation(); // Prevent tree expand/collapse
              onSpeciesClick(node.originalName || node.name);
            }
          }}
          title={isCSVEntry ? `Click to edit "${node.originalName || node.name}" in raw CSV viewer` : undefined}
        >
          {node.originalName || node.name}
        </span>

        {/* Species Count Badge - show only for structural parent nodes (not CSV entries) */}
        {hasChildren && !isCSVEntry && (
          <span className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0 rounded-full font-semibold flex-shrink-0">
            {node.speciesCount} {node.speciesCount === 1 ? 'sp.' : 'spp.'}
          </span>
        )}

        {/* Haplotype Count for CSV Entries - show for all CSV entries with data */}
        {isCSVEntry && node.siteOccurrences && (
          <span className="text-[8px] bg-purple-100 text-purple-700 px-1 py-0 rounded-full font-semibold flex-shrink-0">
            {totalHaplotypes} hapl.
          </span>
        )}

        {/* Taxonomy Source and Confidence for CSV Entries - show for all CSV entries */}
        {isCSVEntry && node.source && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <span className="text-[8px] text-gray-500">
              {node.source.toUpperCase()}
            </span>
            {node.confidence && (
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: getConfidenceColor(node.confidence) }}
                title={`Confidence: ${node.confidence}`}
              />
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="border-l border-gray-300 ml-1">
          {node.children.map((child, index) => (
            <TreeNodeComponent
              key={`${child.name}-${child.rank}-${index}`}
              node={child}
              level={level + 1}
              onSpeciesClick={onSpeciesClick}
              highlightedTaxon={highlightedTaxon}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaxonomicTreeView({ tree, containerHeight, onSpeciesClick, highlightedTaxon }: TaxonomicTreeViewProps) {
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);

  // Scroll to highlighted taxon when it changes
  useEffect(() => {
    if (!highlightedTaxon || !treeContainerRef.current) return;
    const timer = setTimeout(() => {
      const el = treeContainerRef.current?.querySelector(`[data-taxon-name="${CSS.escape(highlightedTaxon)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightedTaxon]);

  // Handle species click - show action options
  const handleSpeciesClick = (speciesName: string) => {
    console.log('[TAXONOMIC TREE] Species clicked:', speciesName);
    setSelectedSpecies(speciesName);
    setShowActionDialog(true);
  };

  // Handle Edit in CSV action
  const handleEditInCSV = () => {
    console.log('[TAXONOMIC TREE] Edit in CSV clicked for:', selectedSpecies);
    if (selectedSpecies && onSpeciesClick) {
      console.log('[TAXONOMIC TREE] Calling onSpeciesClick with:', selectedSpecies);
      onSpeciesClick(selectedSpecies);
    }
    setShowActionDialog(false);
    setSelectedSpecies(null);
  };

  // Handle Fetch Info action - open Google search in new tab
  const handleFetchInfo = () => {
    if (!selectedSpecies) return;
    const query = encodeURIComponent(selectedSpecies);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
    setShowActionDialog(false);
    setSelectedSpecies(null);
  };

  return (
    <div
      className="flex flex-col bg-white border rounded-md overflow-auto"
      style={{ height: `${containerHeight}px` }}
    >
      {/* Tree Container */}
      <div ref={treeContainerRef} className="flex-1 px-2 py-2">
        {tree.children.length > 0 ? (
          tree.children.map((child, index) => (
            <TreeNodeComponent
              key={`${child.name}-${child.rank}-${index}`}
              node={child}
              level={0}
              onSpeciesClick={handleSpeciesClick}
              highlightedTaxon={highlightedTaxon}
            />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs">
            No species found
          </div>
        )}
      </div>

      {/* Action Selection Dialog */}
      <Dialog open={showActionDialog} onOpenChange={setShowActionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Species Actions</DialogTitle>
            <DialogDescription>
              What would you like to do with "{selectedSpecies}"?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={handleEditInCSV}
              className="w-full justify-start gap-2"
              variant="outline"
            >
              <Edit className="w-4 h-4" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">Edit in CSV</span>
                <span className="text-xs text-gray-500">Open CSV editor to correct the species name</span>
              </div>
            </Button>
            <Button
              onClick={handleFetchInfo}
              className="w-full justify-start gap-2"
              variant="outline"
            >
              <Info className="w-4 h-4" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">Search Online</span>
                <span className="text-xs text-gray-500">Open a Google search for this taxon</span>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowActionDialog(false);
                setSelectedSpecies(null);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
