/**
 * Local Processing Dependency Checker - Types & Client Utils
 * Client-safe types and utilities (no Node.js dependencies)
 */

export interface ProcessingDependency {
  name: string;
  description: string;
  type: 'python-package' | 'system-binary' | 'directory';
  checkCommand?: string;
  installCommand?: string;
  required: boolean;
  status: 'checking' | 'ok' | 'error' | 'warning';
  error?: string;
  version?: string;
  autoFixable: boolean;
}

export interface ProcessingCheckResult {
  canProcess: boolean;
  dependencies: ProcessingDependency[];
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Cached dependency check result stored in localStorage
 */
interface CachedDependencyCheck {
  canProcess: boolean;
  timestamp: number;
  version?: string; // Python version
}

/**
 * Get cached dependency check from localStorage (24hr cache)
 */
export function getCachedDependencyCheck(): CachedDependencyCheck | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem('dependency_check_cache');
    if (!cached) return null;

    const parsed = JSON.parse(cached) as CachedDependencyCheck;
    const now = Date.now();
    const cacheAge = now - parsed.timestamp;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // Cache is valid for 24 hours
    if (cacheAge < TWENTY_FOUR_HOURS) {
      console.log(`[CACHE] Using cached dependency check (${Math.round(cacheAge / 1000 / 60)}min old)`);
      return parsed;
    }

    console.log('[CACHE] Dependency check cache expired, will re-check');
    return null;
  } catch (error) {
    console.error('[CACHE] Error reading dependency check cache:', error);
    return null;
  }
}

/**
 * Save dependency check result to localStorage
 */
export function cacheDependencyCheck(canProcess: boolean, version?: string): void {
  if (typeof window === 'undefined') return;

  try {
    const cache: CachedDependencyCheck = {
      canProcess,
      timestamp: Date.now(),
      version,
    };
    localStorage.setItem('dependency_check_cache', JSON.stringify(cache));
    console.log('[CACHE] Saved dependency check to cache');
  } catch (error) {
    console.error('[CACHE] Error saving dependency check cache:', error);
  }
}

/**
 * Clear dependency check cache (useful after installing dependencies)
 */
export function clearDependencyCache(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem('dependency_check_cache');
    console.log('[CACHE] Cleared dependency check cache');
  } catch (error) {
    console.error('[CACHE] Error clearing dependency check cache:', error);
  }
}

/**
 * Get detailed installation instructions for a dependency
 */
export function getInstallationInstructions(dependency: ProcessingDependency): string {
  const instructions: Record<string, string> = {
    'Python 3.8+': `
Install Python 3.8 or later:
1. Download from https://www.python.org/downloads/
2. Run installer and CHECK "Add Python to PATH"
3. Restart your terminal
4. Verify: python --version
    `,
    'FFmpeg': `
Install FFmpeg (optional but recommended):
- Windows: winget install ffmpeg
- Mac: brew install ffmpeg
- Linux: sudo apt install ffmpeg
Verify: ffmpeg -version
    `,
  };

  if (instructions[dependency.name]) {
    return instructions[dependency.name];
  }

  if (dependency.type === 'python-package' && dependency.installCommand) {
    return `
Install ${dependency.name}:
Run in terminal: ${dependency.installCommand}

Or install all packages at once:
pip install opencv-python numpy ultralytics torch scipy
    `;
  }

  return 'No installation instructions available.';
}
