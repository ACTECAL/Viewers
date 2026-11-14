'use strict';
// The window's place and size from the last session, kept only while its title bar is still on one of the
// screens (a screen may have been unplugged). No Electron import; test/main.test.mjs.
const DEFAULT_BOUNDS = Object.freeze({ width: 1400, height: 900 });
const MIN_BOUNDS = Object.freeze({ width: 900, height: 600 });

/** Bounds for the new window from saved ones ({ x, y, width, height, maximized }) and the screens' work areas. */
function restoreBounds(saved, workAreas = []) {
  if (!saved || typeof saved !== 'object' || !['x', 'y', 'width', 'height'].every((name) => Number.isFinite(saved[name]))) {
    return { ...DEFAULT_BOUNDS, maximized: false };
  }
  const width = Math.max(MIN_BOUNDS.width, Math.round(saved.width));
  const height = Math.max(MIN_BOUNDS.height, Math.round(saved.height));
  const maximized = saved.maximized === true;
  // At least 100 px of the title bar must be on a screen.
  const area = workAreas.find(
    (screen) => saved.x + 100 <= screen.x + screen.width && saved.x + width - 100 >= screen.x && saved.y >= screen.y && saved.y + 40 <= screen.y + screen.height
  );
  if (!area) return { width, height, maximized };
  return { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.min(width, area.width), height: Math.min(height, area.height), maximized };
}

module.exports = { DEFAULT_BOUNDS, MIN_BOUNDS, restoreBounds };
