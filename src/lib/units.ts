/**
 * Unit conversion utilities for metric/imperial system
 */

export type UnitSystem = 'metric' | 'imperial';

export interface UnitConfig {
  metric: {
    symbol: string;
    label: string;
  };
  imperial: {
    symbol: string;
    label: string;
  };
  convert: {
    toImperial: (value: number) => number;
    toMetric: (value: number) => number;
  };
}

// Unit conversion configurations
export const UNIT_CONFIGS = {
  // Temperature
  temperature: {
    metric: { symbol: '°C', label: 'Celsius' },
    imperial: { symbol: '°F', label: 'Fahrenheit' },
    convert: {
      toImperial: (c: number) => (c * 9/5) + 32,
      toMetric: (f: number) => (f - 32) * 5/9
    }
  },
  
  // Distance/Height (for wave height, sea level)
  distance: {
    metric: { symbol: 'm', label: 'meters' },
    imperial: { symbol: 'ft', label: 'feet' },
    convert: {
      toImperial: (m: number) => m * 3.28084,
      toMetric: (ft: number) => ft / 3.28084
    }
  },
  
  // Wind speed
  windSpeed: {
    metric: { symbol: 'knots', label: 'knots' }, // Keep knots as "metric" standard for marine
    imperial: { symbol: 'mph', label: 'miles per hour' },
    convert: {
      toImperial: (knots: number) => knots * 1.15078, // knots to mph
      toMetric: (mph: number) => mph / 1.15078 // mph to knots
    }
  },
  
  // Solar irradiance (no conversion needed - W/m² is universal)
  irradiance: {
    metric: { symbol: 'W/m²', label: 'watts per square meter' },
    imperial: { symbol: 'W/m²', label: 'watts per square meter' },
    convert: {
      toImperial: (value: number) => value, // No conversion
      toMetric: (value: number) => value
    }
  }
} as const;

export type UnitType = keyof typeof UNIT_CONFIGS;

/**
 * Convert a value from one unit system to another
 */
export function convertValue(
  value: number, 
  unitType: UnitType, 
  fromSystem: UnitSystem, 
  toSystem: UnitSystem
): number {
  if (fromSystem === toSystem) return value;
  
  const config = UNIT_CONFIGS[unitType];
  if (fromSystem === 'metric' && toSystem === 'imperial') {
    return config.convert.toImperial(value);
  } else if (fromSystem === 'imperial' && toSystem === 'metric') {
    return config.convert.toMetric(value);
  }
  
  return value;
}

/**
 * Get the appropriate unit symbol for a given unit type and system
 */
export function getUnitSymbol(unitType: UnitType, system: UnitSystem): string {
  return UNIT_CONFIGS[unitType][system].symbol;
}

/**
 * Get the appropriate unit label for a given unit type and system
 */
export function getUnitLabel(unitType: UnitType, system: UnitSystem): string {
  return UNIT_CONFIGS[unitType][system].label;
}

/**
 * Convert value and format with appropriate unit
 */
export function formatValueWithUnit(
  value: number,
  unitType: UnitType,
  targetSystem: UnitSystem,
  precision: number = 1
): string {
  // For display purposes, we assume the source is always metric (from API)
  const convertedValue = convertValue(value, unitType, 'metric', targetSystem);
  const unit = getUnitSymbol(unitType, targetSystem);
  
  return `${convertedValue.toFixed(precision)}${unit}`;
}

/**
 * Parameter type to unit type mapping
 * Maps the parameter keys to their corresponding unit types
 */
export const PARAMETER_TO_UNIT_TYPE: Record<string, UnitType> = {
  // Temperature parameters
  'seaSurfaceTemperature': 'temperature',
  'temperature2m': 'temperature',
  'Temp': 'temperature', // GP files
  'Temperature': 'temperature', // GP files (alternative)

  // Distance parameters
  'waveHeight': 'distance',
  'seaLevelHeightMsl': 'distance',
  'Sea Level': 'distance', // Marine/Meteo alternative

  // Wind speed
  'windSpeed10m': 'windSpeed',
  'Wind Speed': 'windSpeed', // Marine/Meteo alternative

  // Solar irradiance
  'ghi': 'irradiance',
  'IR': 'irradiance', // GP files - Infrared/Irradiance
  'Irradiance': 'irradiance', // GP files (alternative)

  // No conversion needed for these:
  // 'waveDirection': direction (degrees)
  // 'windDirection10m': direction (degrees)
  // 'wavePeriod': time (seconds)
  // 'Wave Dir': direction (degrees)
  // 'Wind Dir': direction (degrees)
};

/**
 * Parameter display names and units mapping
 * Maps parameter keys to their display names and unit symbols
 */
export const PARAMETER_DISPLAY_INFO: Record<string, { label: string; unit: string; tooltip?: string }> = {
  // Marine/Meteo parameters
  'waveHeight': { label: 'Sig. Wave Height', unit: 'm' },
  'waveDirection': { label: 'Wave Direction', unit: '° North' },
  'wavePeriod': { label: 'Wave Period', unit: 'sec' },
  'seaSurfaceTemperature': { label: 'Sea S. Temp.', unit: '°C' },
  'seaLevelHeightMsl': { label: 'Tide', unit: 'm' },
  'temperature2m': { label: 'Air Temp.', unit: '°C' },
  'windSpeed10m': { label: 'Wind Speed', unit: 'km/h' },
  'windDirection10m': { label: 'Wind Direction', unit: '° North' },
  'ghi': { label: 'Solar Irradiance', unit: 'W/m²' },

  // Marine/Meteo alternative names (from PinMarineMeteoPlot)
  'Wave Height': { label: 'Sig. Wave Height', unit: 'm' },
  'Wind Speed (10m)': { label: 'Wind Speed', unit: 'km/h' },
  'Wind Direction (10m)': { label: 'Wind Direction', unit: '° North' },
  'Sea Level (MSL)': { label: 'Tide', unit: 'm' },
  'Wave Period': { label: 'Wave Period', unit: 'sec' },
  'Wave Direction': { label: 'Wave Direction', unit: '° North' },
  'Air Temperature (2m)': { label: 'Air Temp.', unit: '°C' },
  'Sea Surface Temp (0m)': { label: 'Sea S. Temp.', unit: '°C' },
  'Global Horizontal Irradiance (GHI)': { label: 'Solar Irradiance', unit: 'W/m²' },

  // GP file parameters
  'Temp': { label: 'Temp', unit: '°C' },
  'Temperature': { label: 'Temperature', unit: '°C' },
  'IR': { label: 'Turbidity', unit: 'a.u.', tooltip: 'Turbidity (arbitrary units)' },
  'Vis': { label: 'Vis', unit: 'a.u.' },
  'Lux': { label: 'Light', unit: 'Lux' },
  'accel_x': { label: 'accel_x', unit: 'g' },
  'accel_y': { label: 'accel_y', unit: 'g' },
  'accel_z': { label: 'accel_z', unit: 'g' },
  'Mag_x': { label: 'Mag_x', unit: 'a.u.' },
  'Mag_y': { label: 'Mag_y', unit: 'a.u.' },
  'H.Angle': { label: 'Direction', unit: '° North' },
  'VBAT': { label: 'Battery', unit: 'V' },

  // Add common variations - these will be updated if they appear in files
  // The system will handle unknown parameters by showing them as-is with "Value" unit
};

/**
 * Check if a parameter needs unit conversion
 */
export function parameterNeedsConversion(parameterKey: string): boolean {
  return parameterKey in PARAMETER_TO_UNIT_TYPE;
}

/**
 * Get the unit type for a parameter
 */
export function getParameterUnitType(parameterKey: string): UnitType | null {
  return PARAMETER_TO_UNIT_TYPE[parameterKey] || null;
}

/**
 * Get parameter display label (without unit)
 */
export function getParameterLabel(parameterKey: string): string {
  return PARAMETER_DISPLAY_INFO[parameterKey]?.label || parameterKey;
}

/**
 * Get parameter unit symbol
 */
export function getParameterUnit(parameterKey: string): string {
  return PARAMETER_DISPLAY_INFO[parameterKey]?.unit || '';
}

/**
 * Get parameter display label with unit in parentheses
 * Example: "Temp (°C)" or "Wave Height (m)"
 */
export function getParameterLabelWithUnit(parameterKey: string): string {
  const info = PARAMETER_DISPLAY_INFO[parameterKey];
  if (info && info.unit) {
    return `${info.label} (${info.unit})`;
  }
  return parameterKey; // Fallback to raw parameter name if not in mapping
}

/**
 * Get parameter tooltip/title for display
 * Returns the tooltip if defined, otherwise returns the label with full unit description
 */
export function getParameterTooltip(parameterKey: string): string {
  const info = PARAMETER_DISPLAY_INFO[parameterKey];
  if (info?.tooltip) {
    return info.tooltip;
  }
  if (info && info.unit) {
    return `${info.label} (${info.unit})`;
  }
  return parameterKey;
}