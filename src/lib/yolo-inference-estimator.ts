/**
 * YOLOv8 Inference Cost & Time Estimator
 * Calculates estimated processing time and cost for local vs Modal.ai cloud processing
 */

export interface VideoSpecs {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  totalFrames: number;
}

export interface HardwareSpecs {
  gpuName: string;
  gpuVramGb?: number;
  cpuCores: number;
  ramGb: number;
  platform: string;
  benchmarkFps?: number; // YOLOv8 inference FPS from previous runs
}

export interface InferenceEstimate {
  estimatedTimeSeconds: number;
  estimatedTimeFormatted: string;
  estimatedCostUSD?: number;
  framesPerSecond: number;
  confidence: 'low' | 'medium' | 'high';
  notes: string[];
}

/**
 * GPU Performance Benchmarks (YOLOv8n on 1920x1080)
 * Based on Ultralytics benchmarks and community testing
 */
const GPU_BENCHMARKS: Record<string, number> = {
  // NVIDIA (high-end)
  'RTX 4090': 140,
  'RTX 4080': 110,
  'RTX 4070': 85,
  'RTX 3090': 95,
  'RTX 3080': 80,
  'RTX 3070': 65,

  // NVIDIA (mid-range)
  'RTX 3060': 50,
  'RTX 2080': 55,
  'RTX 2070': 45,
  'RTX 2060': 35,
  'GTX 1660': 25,

  // NVIDIA (data center)
  'A100': 180,
  'A10G': 70,
  'T4': 40,
  'V100': 85,

  // AMD
  'RX 7900': 75,
  'RX 6900': 65,
  'RX 6800': 55,

  // Intel
  'Arc A770': 40,
  'Arc A750': 35,

  // CPU fallback (very slow)
  'CPU': 2,
};

/**
 * Modal.ai GPU Pricing (as of 2024)
 * https://modal.com/pricing
 */
const MODAL_PRICING = {
  T4: {
    fpsEstimate: 40,
    costPerSecond: 0.000_4, // $0.40 per hour
    setupTimeSeconds: 30,
  },
  A10G: {
    fpsEstimate: 70,
    costPerSecond: 0.001_222, // $1.10 per hour
    setupTimeSeconds: 30,
  },
  A100_40GB: {
    fpsEstimate: 180,
    costPerSecond: 0.003_667, // $3.20 per hour
    setupTimeSeconds: 40,
  },
  A100_80GB: {
    fpsEstimate: 180,
    costPerSecond: 0.004_5, // $4.00 per hour
    setupTimeSeconds: 40,
  },
};

/**
 * Estimate local YOLOv8 inference time
 */
export function estimateLocalInference(
  video: VideoSpecs,
  hardware: HardwareSpecs
): InferenceEstimate {
  const notes: string[] = [];
  let fps = hardware.benchmarkFps || 0;
  let confidence: 'low' | 'medium' | 'high' = 'low';

  // If we have a benchmark from previous runs, use that (highest confidence)
  if (hardware.benchmarkFps && hardware.benchmarkFps > 0) {
    fps = hardware.benchmarkFps;
    confidence = 'high';
    notes.push('Using measured performance from previous runs');
  }
  // Otherwise try to match GPU from benchmark database
  else if (hardware.gpuName) {
    const gpuKey = Object.keys(GPU_BENCHMARKS).find(key =>
      hardware.gpuName.toUpperCase().includes(key.toUpperCase())
    );

    if (gpuKey) {
      fps = GPU_BENCHMARKS[gpuKey];
      confidence = 'medium';
      notes.push(`Estimated based on ${gpuKey} benchmarks`);
    } else {
      // Fall back to CPU
      fps = GPU_BENCHMARKS['CPU'];
      confidence = 'low';
      notes.push('GPU not recognized - using CPU fallback estimate');
      notes.push('Actual performance may vary significantly');
    }
  } else {
    // No GPU detected at all - fall back to CPU
    fps = GPU_BENCHMARKS['CPU'];
    confidence = 'low';
    notes.push('No GPU detected - using CPU fallback estimate');
    notes.push('Actual performance may vary significantly');
  }

  // Adjust for video resolution (YOLOv8 scales linearly with pixel count)
  const resolutionFactor = (video.width * video.height) / (1920 * 1080);
  fps = fps / resolutionFactor;

  // Estimate total time
  const estimatedTimeSeconds = video.totalFrames / fps;

  // Check if VRAM is sufficient (YOLOv8n needs ~4GB for 1080p)
  const vramNeeded = 4 * resolutionFactor;
  if (hardware.gpuVramGb && hardware.gpuVramGb < vramNeeded) {
    notes.push(`⚠️ Low VRAM: Need ${vramNeeded.toFixed(1)}GB, have ${hardware.gpuVramGb}GB`);
    notes.push('Processing may be slower or fail');
    confidence = 'low';
  }

  return {
    estimatedTimeSeconds,
    estimatedTimeFormatted: formatTime(estimatedTimeSeconds),
    framesPerSecond: Math.round(fps * 10) / 10,
    confidence,
    notes,
  };
}

/**
 * Estimate Modal.ai cloud inference time and cost
 */
export function estimateModalInference(
  video: VideoSpecs,
  gpuType: keyof typeof MODAL_PRICING = 'T4'
): InferenceEstimate & { estimatedCostUSD: number } {
  const config = MODAL_PRICING[gpuType];
  const notes: string[] = [];

  // Adjust for video resolution
  const resolutionFactor = (video.width * video.height) / (1920 * 1080);
  const fps = config.fpsEstimate / resolutionFactor;

  // Calculate inference time
  const inferenceTimeSeconds = video.totalFrames / fps;

  // Add setup overhead (cold start)
  const totalTimeSeconds = inferenceTimeSeconds + config.setupTimeSeconds;

  // Calculate cost (inference time only, not including setup)
  const costUSD = inferenceTimeSeconds * config.costPerSecond;

  notes.push(`Using Modal ${gpuType} GPU`);
  notes.push(`Includes ~${config.setupTimeSeconds}s cold start time`);
  notes.push(`Processing: ${Math.round(fps)} fps`);

  return {
    estimatedTimeSeconds: totalTimeSeconds,
    estimatedTimeFormatted: formatTime(totalTimeSeconds),
    estimatedCostUSD: Math.round(costUSD * 100) / 100, // Round to cents
    framesPerSecond: Math.round(fps * 10) / 10,
    confidence: 'high',
    notes,
  };
}

/**
 * Compare local vs cloud options
 */
export function compareOptions(video: VideoSpecs, hardware: HardwareSpecs) {
  const local = estimateLocalInference(video, hardware);
  const modalT4 = estimateModalInference(video, 'T4');
  const modalA10G = estimateModalInference(video, 'A10G');

  return {
    local,
    cloud: {
      T4: modalT4,
      A10G: modalA10G,
    },
    recommendation: getRecommendation(local, modalT4, modalA10G),
  };
}

/**
 * Get processing recommendation
 */
function getRecommendation(
  local: InferenceEstimate,
  modalT4: InferenceEstimate & { estimatedCostUSD: number },
  modalA10G: InferenceEstimate & { estimatedCostUSD: number }
): string {
  // If local is fast (< 5 minutes) and confident, recommend local
  if (local.estimatedTimeSeconds < 300 && local.confidence === 'high') {
    return 'local';
  }

  // If local is very slow (> 30 minutes), recommend cloud
  if (local.estimatedTimeSeconds > 1800) {
    return modalT4.estimatedCostUSD! < 0.50 ? 'modal-t4' : 'modal-a10g';
  }

  // If cost is very cheap (< $0.10), recommend Modal
  if (modalT4.estimatedCostUSD! < 0.10) {
    return 'modal-t4';
  }

  // Default to local if confidence is medium or high
  if (local.confidence !== 'low') {
    return 'local';
  }

  // Otherwise recommend Modal T4 (good balance)
  return 'modal-t4';
}

/**
 * Format seconds to human-readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

/**
 * Parse GPU name from system info
 */
export function parseGPUName(gpuInfo: string): { name: string; vram?: number } {
  const lines = gpuInfo.split('\n');

  for (const line of lines) {
    // Extract GPU name (look for NVIDIA, AMD, Intel patterns)
    const nvidiaMatch = line.match(/(RTX|GTX|GeForce|Tesla|Quadro|A\d+G?|V100|T4)\s*\d+\w*/i);
    const amdMatch = line.match(/(RX|Radeon)\s*\d+\w*/i);
    const intelMatch = line.match(/(Arc|Iris|UHD)\s*\w+\d+/i);

    const name = nvidiaMatch?.[0] || amdMatch?.[0] || intelMatch?.[0];

    // Extract VRAM if available
    const vramMatch = line.match(/(\d+)\s*(GB|MB)/i);
    let vram: number | undefined;
    if (vramMatch) {
      const value = parseInt(vramMatch[1]);
      const unit = vramMatch[2].toUpperCase();
      vram = unit === 'GB' ? value : value / 1024;
    }

    if (name) {
      return { name, vram };
    }
  }

  return { name: 'Unknown GPU' };
}
