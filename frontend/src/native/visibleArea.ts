// Matches Mobile.css: the bottom sheet is this much of the screen when open, and this many pixels when collapsed.
const COLLAPSED_SHEET_PX = 64;
const MOBILE_MAX_WIDTH = 768;
const SIDEBAR_GAP_PX = 8;

export type VisibleArea = {
  /** Edges relative to the map's top-left corner. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

const safeInset = (side: 'top' | 'bottom') =>
  parseFloat(getComputedStyle(document.querySelector('.map-panel') || document.body).getPropertyValue(`--safe-area-inset-${side}`)) || 0;

// The panel's height once its own transition has finished.
function bottomPanelHeight(): number {
  const strip = document.querySelector<HTMLElement>('.route-image-strip');
  if (!strip) return 0;
  const scroller = strip.querySelector<HTMLElement>('.route-image-strip-scroller');
  const target = parseFloat(strip.style.getPropertyValue('--route-image-height'));
  const current = scroller?.getBoundingClientRect().height ?? 0;
  return strip.getBoundingClientRect().height - current + (Number.isFinite(target) ? target : current);
}

/**
 * The part of the map not covered by the bottom sheet, the sidebar or the bottom image panel,
 * as it will be once the current panel states have settled. It reads class names and target
 * sizes instead of animated positions, so it can run while panels are still moving.
 * sheet states what the mobile bottom sheet is about to do, when the page has not caught up yet.
 */
export function visibleMapArea(mapElement: HTMLElement, sheet?: 'open' | 'collapsed'): VisibleArea {
  const container = mapElement.getBoundingClientRect();
  let left = 0, bottom = 0;
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  // While a photo location is edited the sidebar is see-through and the map is fully usable.
  if (sidebar && !document.querySelector('.trip-gallery-panel.adding-gps')) {
    if (window.innerWidth <= MOBILE_MAX_WIDTH) {
      const collapsed = sheet ? sheet === 'collapsed' : sidebar.classList.contains('collapsed');
      bottom = collapsed ? COLLAPSED_SHEET_PX + safeInset('bottom') : sidebar.offsetHeight;
    } else if (!sidebar.classList.contains('collapsed')) {
      left = Math.max(0, sidebar.getBoundingClientRect().right - container.left + SIDEBAR_GAP_PX);
    }
  }
  bottom = Math.max(bottom, bottomPanelHeight() - (window.innerHeight - container.bottom));
  const top = safeInset('top');
  const right = container.width;
  const floor = container.height - bottom;
  return { left, top, right, bottom: floor, centerX: (left + right) / 2, centerY: (top + floor) / 2 };
}

/** The visible area's center in screen coordinates, for elements positioned over the map. */
export function visibleCenterOnScreen(mapElement: HTMLElement): { x: number; y: number } {
  const container = mapElement.getBoundingClientRect();
  const area = visibleMapArea(mapElement);
  return { x: container.left + area.centerX, y: container.top + area.centerY };
}
