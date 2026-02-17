'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw, Info } from 'lucide-react';

export interface BenthicActivityParams {
  threshold: number;
  min_area: number;
  max_area: number;
  min_circularity: number;
  max_aspect_ratio: number;
  morph_kernel_size: number;
  max_distance: number;
  max_skip_frames: number;
  min_track_length: number;
  min_displacement: number;
  min_speed: number;
  max_speed: number;
}

interface SavedParamSet {
  id: string;
  name: string;
  is_preset: boolean;
  threshold: number;
  min_area: number;
  max_area: number;
  min_circularity: number;
  max_aspect_ratio: number;
  morph_kernel_size: number;
  max_distance: number;
  max_skip_frames: number;
  min_track_length: number;
  min_displacement: number;
  min_speed: number;
  max_speed: number;
}

interface BenthicActivitySettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentParams: BenthicActivityParams;
  onParamsChange: (params: BenthicActivityParams) => void;
}

const PRESET_PARAMS: Record<string, BenthicActivityParams> = {
  conservative: {
    threshold: 20,
    min_area: 100,
    max_area: 5000,
    min_circularity: 0.3,
    max_aspect_ratio: 3.0,
    morph_kernel_size: 3,
    max_distance: 30.0,
    max_skip_frames: 3,
    min_track_length: 5,
    min_displacement: 10.0,
    min_speed: 0.1,
    max_speed: 50.0,
  },
  balanced: {
    threshold: 25,
    min_area: 50,
    max_area: 8000,
    min_circularity: 0.2,
    max_aspect_ratio: 4.0,
    morph_kernel_size: 5,
    max_distance: 50.0,
    max_skip_frames: 5,
    min_track_length: 3,
    min_displacement: 5.0,
    min_speed: 0.05,
    max_speed: 100.0,
  },
  aggressive: {
    threshold: 30,
    min_area: 20,
    max_area: 10000,
    min_circularity: 0.1,
    max_aspect_ratio: 5.0,
    morph_kernel_size: 7,
    max_distance: 80.0,
    max_skip_frames: 10,
    min_track_length: 2,
    min_displacement: 2.0,
    min_speed: 0.01,
    max_speed: 200.0,
  },
};

export default function BenthicActivitySettingsDialog({
  isOpen,
  onClose,
  currentParams,
  onParamsChange,
}: BenthicActivitySettingsDialogProps) {
  const [params, setParams] = useState<BenthicActivityParams>(currentParams);
  const [savedSets, setSavedSets] = useState<SavedParamSet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSavedParamSets();
    }
  }, [isOpen]);

  const loadSavedParamSets = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/motion-analysis/crab-params');
      const result = await response.json();
      if (result.success) {
        setSavedSets(result.params || []);
      }
    } catch (error) {
      console.error('Failed to load saved param sets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetClick = (presetName: string) => {
    const presetParams = PRESET_PARAMS[presetName];
    setParams(presetParams);
  };

  const handleSaveCustomSet = async () => {
    if (!newSetName.trim()) {
      alert('Please enter a name for this parameter set');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/motion-analysis/crab-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSetName.trim(),
          params: params,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setSaveDialogOpen(false);
        setNewSetName('');
        loadSavedParamSets();
      } else {
        alert(`Failed to save: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to save param set:', error);
      alert('Failed to save parameter set. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadSavedSet = (savedSet: SavedParamSet) => {
    setParams({
      threshold: savedSet.threshold,
      min_area: savedSet.min_area,
      max_area: savedSet.max_area,
      min_circularity: savedSet.min_circularity,
      max_aspect_ratio: savedSet.max_aspect_ratio,
      morph_kernel_size: savedSet.morph_kernel_size,
      max_distance: savedSet.max_distance,
      max_skip_frames: savedSet.max_skip_frames,
      min_track_length: savedSet.min_track_length,
      min_displacement: savedSet.min_displacement,
      min_speed: savedSet.min_speed,
      max_speed: savedSet.max_speed,
    });
  };

  const handleApply = () => {
    onParamsChange(params);
    onClose();
  };

  const handleParamChange = (key: keyof CrabDetectionParams, value: number) => {
    setParams({ ...params, [key]: value });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a1a] rounded-lg w-full max-w-2xl shadow-xl border border-gray-800 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-orange-400" />
            <span className="text-sm font-medium text-gray-200">Benthic Activity Settings</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {/* Presets */}
          <div className="mb-4">
            <label className="text-xs text-gray-400 mb-2 block">Presets</label>
            <div className="flex gap-2">
              <button
                onClick={() => handlePresetClick('conservative')}
                className="flex-1 px-3 py-2 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
              >
                Conservative
              </button>
              <button
                onClick={() => handlePresetClick('balanced')}
                className="flex-1 px-3 py-2 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
              >
                Balanced
              </button>
              <button
                onClick={() => handlePresetClick('aggressive')}
                className="flex-1 px-3 py-2 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
              >
                Aggressive
              </button>
            </div>
          </div>

          {/* Saved Parameter Sets */}
          {savedSets.length > 0 && (
            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-2 block">Your Saved Sets</label>
              <div className="grid grid-cols-2 gap-2">
                {savedSets.filter(s => !s.is_preset).map((savedSet) => (
                  <button
                    key={savedSet.id}
                    onClick={() => handleLoadSavedSet(savedSet)}
                    className="px-3 py-2 rounded text-xs text-left bg-blue-900/20 text-blue-300 hover:bg-blue-900/30 border border-blue-700/30 transition-colors truncate"
                  >
                    {savedSet.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Blob Detection Parameters */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-300 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-orange-500 rounded"></span>
              Blob Detection
            </h3>
            <div className="space-y-3">
              <SliderControl
                label="Threshold"
                value={params.threshold}
                onChange={(v) => handleParamChange('threshold', v)}
                min={10}
                max={50}
                step={1}
                tooltip="Brightness difference threshold for blob detection (higher = more selective)"
              />
              <SliderControl
                label="Min Area (px²)"
                value={params.min_area}
                onChange={(v) => handleParamChange('min_area', v)}
                min={10}
                max={500}
                step={10}
                tooltip="Minimum blob size in pixels squared"
              />
              <SliderControl
                label="Max Area (px²)"
                value={params.max_area}
                onChange={(v) => handleParamChange('max_area', v)}
                min={1000}
                max={20000}
                step={100}
                tooltip="Maximum blob size in pixels squared"
              />
              <SliderControl
                label="Min Circularity"
                value={params.min_circularity}
                onChange={(v) => handleParamChange('min_circularity', v)}
                min={0.1}
                max={1.0}
                step={0.05}
                tooltip="Minimum circularity (1.0 = perfect circle, 0.1 = very irregular)"
              />
              <SliderControl
                label="Max Aspect Ratio"
                value={params.max_aspect_ratio}
                onChange={(v) => handleParamChange('max_aspect_ratio', v)}
                min={1.0}
                max={10.0}
                step={0.5}
                tooltip="Maximum width/height ratio (higher allows more elongated shapes)"
              />
              <SliderControl
                label="Morph Kernel Size"
                value={params.morph_kernel_size}
                onChange={(v) => handleParamChange('morph_kernel_size', v)}
                min={1}
                max={15}
                step={2}
                tooltip="Size of morphological operations kernel (higher = more smoothing)"
              />
            </div>
          </div>

          {/* Tracking Parameters */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-300 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-blue-500 rounded"></span>
              Tracking
            </h3>
            <div className="space-y-3">
              <SliderControl
                label="Max Distance (px)"
                value={params.max_distance}
                onChange={(v) => handleParamChange('max_distance', v)}
                min={10}
                max={200}
                step={5}
                tooltip="Maximum distance to match blob between frames"
              />
              <SliderControl
                label="Max Skip Frames"
                value={params.max_skip_frames}
                onChange={(v) => handleParamChange('max_skip_frames', v)}
                min={1}
                max={20}
                step={1}
                tooltip="Maximum frames a track can be missing before termination"
              />
            </div>
          </div>

          {/* Validation Parameters */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-300 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-green-500 rounded"></span>
              Track Validation
            </h3>
            <div className="space-y-3">
              <SliderControl
                label="Min Track Length"
                value={params.min_track_length}
                onChange={(v) => handleParamChange('min_track_length', v)}
                min={1}
                max={20}
                step={1}
                tooltip="Minimum number of frames for a valid track"
              />
              <SliderControl
                label="Min Displacement (px)"
                value={params.min_displacement}
                onChange={(v) => handleParamChange('min_displacement', v)}
                min={1}
                max={50}
                step={1}
                tooltip="Minimum total movement distance for a valid track"
              />
              <SliderControl
                label="Min Speed (px/frame)"
                value={params.min_speed}
                onChange={(v) => handleParamChange('min_speed', v)}
                min={0.01}
                max={5.0}
                step={0.05}
                tooltip="Minimum average speed for a valid track"
              />
              <SliderControl
                label="Max Speed (px/frame)"
                value={params.max_speed}
                onChange={(v) => handleParamChange('max_speed', v)}
                min={10}
                max={500}
                step={10}
                tooltip="Maximum average speed (filters out noise)"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between flex-shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => setSaveDialogOpen(true)}
              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors flex items-center gap-1.5"
            >
              <Save size={12} />
              Save as...
            </button>
            <button
              onClick={() => setParams(PRESET_PARAMS.balanced)}
              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              Reset
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Save Dialog */}
        {saveDialogOpen && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center rounded-lg">
            <div className="bg-[#1a1a1a] rounded-lg p-4 w-80 border border-gray-800">
              <h3 className="text-sm font-medium text-gray-200 mb-3">Save Parameter Set</h3>
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="Enter a name..."
                className="w-full px-3 py-2 bg-[#151515] border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-3"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCustomSet();
                  if (e.key === 'Escape') setSaveDialogOpen(false);
                }}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setSaveDialogOpen(false)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCustomSet}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  tooltip?: string;
}

function SliderControl({ label, value, onChange, min, max, step, tooltip }: SliderControlProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-gray-400" title={tooltip}>
          {label}
        </label>
        <span className="text-xs text-gray-200 font-mono">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
      />
    </div>
  );
}
