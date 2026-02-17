/**
 * Feature Flags System
 *
 * Allows toggling features on/off via environment variables.
 * This is useful for gradual rollouts and instant rollbacks.
 */

export const FEATURE_FLAGS = {
  /**
   * Data Explorer Panel Integration
   *
   * Adds a slide-out panel to the map-drawing page
   * that provides access to files and saved plots.
   *
   * Always enabled in production.
   */
  DATA_EXPLORER_PANEL: false,
} as const;

/**
 * Check if a feature flag is enabled
 *
 * @param flag - The feature flag to check
 * @returns true if the feature is enabled, false otherwise
 */
export function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[flag];
}

/**
 * Get all enabled feature flags
 *
 * @returns Array of enabled feature flag names
 */
export function getEnabledFeatures(): string[] {
  return Object.entries(FEATURE_FLAGS)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);
}
