/**
 * Return style properties for a waypoint.
 * Expected return object (or null to use default):
 * {
 *   hidden?: boolean;          // Visually hidden
 *   type?: 'dot' | 'pin';      // Marker type
 *   color?: string | string[]; // Marker color(s). Can be an array of two colors.
 *   opacity?: number;          // Marker opacity (0-1)
 * }
 */
function getWaypointStyle(waypoint, segments, colors, context) {
  if (context.isNoTripSelected) {
    return { hidden: true };
  }
  if (context.isReadOnly && !waypoint.icon) {
    return { hidden: true };
  }
  return {
    hidden: false,
    type: waypoint.icon ? 'pin' : 'dot',
    color: colors,
    opacity: context.selectedSegment && !context.waypointInfo.isInSelectedSegment ? 0.4 : 1
  };
}

/**
 * Return style properties for a segment.
 * Expected return object (or null to use default):
 * {
 *   hidden?: boolean;    // Visually hidden
 *   color?: string;      // Line color
 *   opacity?: number;    // Line opacity (0-1)
 *   width?: number;      // Line width
 * }
 */

function getSegmentStyle(segment, color, context) {
  if (!context.showHiddenSegments && context.isNoTripSelected && segment.transportMode === 'flight') {
    return { hidden: true };
  }
  if (!context.showHiddenSegments && segment.isHidden) {
    return { hidden: true };
  }
  return { 
    hidden: false,
    color: color,
    opacity: context.selectedSegment && context.selectedSegment !== segment ? 0.4 : 1,
    width: 4
  };
}

/**
 * Final return statement of the style configuration.
 */
return { getWaypointStyle, getSegmentStyle };
