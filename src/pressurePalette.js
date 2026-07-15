export const PRESSURE_COLOR_STOPS = Object.freeze([
  Object.freeze({ label: 'Base', position: 0 }),
  Object.freeze({ label: 'Low', position: 0.18 }),
  Object.freeze({ label: 'Cool', position: 0.38 }),
  Object.freeze({ label: 'Mid', position: 0.58 }),
  Object.freeze({ label: 'Warm', position: 0.78 }),
  Object.freeze({ label: 'High', position: 1 }),
]);

export const DEFAULT_PRESSURE_PALETTE = Object.freeze([
  '#050f16',
  '#00a8c8',
  '#00f0d8',
  '#ffe600',
  '#ff7a00',
  '#ff2438',
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(color) {
  const normalized = color.replace('#', '');
  const value = Number.parseInt(normalized, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function channelToHex(value) {
  return Math.round(value).toString(16).padStart(2, '0');
}

export function pressureColorAt(value, colorDepth = 1, palette = DEFAULT_PRESSURE_PALETTE) {
  const boosted = clamp01(value * colorDepth);
  const colors = PRESSURE_COLOR_STOPS.map((_, index) => palette[index] || DEFAULT_PRESSURE_PALETTE[index]);

  for (let index = 1; index < PRESSURE_COLOR_STOPS.length; index += 1) {
    const stop = PRESSURE_COLOR_STOPS[index].position;
    const previousStop = PRESSURE_COLOR_STOPS[index - 1].position;

    if (boosted <= stop) {
      const amount = clamp01((boosted - previousStop) / (stop - previousStop));
      const from = hexToRgb(colors[index - 1]);
      const to = hexToRgb(colors[index]);

      return `#${channelToHex(from.r + (to.r - from.r) * amount)}${channelToHex(from.g + (to.g - from.g) * amount)}${channelToHex(from.b + (to.b - from.b) * amount)}`;
    }
  }

  return colors[colors.length - 1];
}
