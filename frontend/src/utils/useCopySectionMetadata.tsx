import { useState } from 'react';
import type { Trip } from '../../../shared/types';
import { ModeThemes } from '../themes/config';

export interface CopySectionMetadataData {
  color: string;
  icon: string;
  mode?: string;
  routingService?: string;
  routingProfile?: string;
  segmentId?: string;
  newName?: string;
}

export function useCopySectionMetadata(trip: Trip, allTrips: Trip[] | undefined, onUpdateTrip: (newTrip: Trip) => void) {
  const [sectionMetadataOffer, setSectionMetadataOffer] = useState<CopySectionMetadataData | null>(null);

  const handleNameChange = (segmentId: string, currentName: string | undefined, newValue: string) => {
    console.log('handleNameChange called with', segmentId, newValue, 'current', currentName);
if (newValue !== (currentName || '') && newValue.trim() !== '') {
      let colorToCopy: string | undefined;
      let iconToCopy: string | undefined;
      let modeToCopy: string | undefined;
      let routingProfileToCopy: string | undefined;
      let routingServiceToCopy: string | undefined;

      let found = trip.segments.find(s => s.id !== segmentId && s.name?.toLowerCase() === newValue.toLowerCase());
      if (!found && allTrips) {
        for (const t of allTrips) {
          found = t.segments.find(s => s.name?.toLowerCase() === newValue.toLowerCase());
          if (found) break;
        }
      }
      if (found) {
        colorToCopy = found.customColor;
        iconToCopy = found.customIcon;
        modeToCopy = found.transportMode;
        routingProfileToCopy = found.routingProfile;
        routingServiceToCopy = found.routingService;
      }

      if (modeToCopy) {
        setSectionMetadataOffer({
          color: colorToCopy || ModeThemes[modeToCopy as any as import('../../../shared/types').TransportMode]?.color || '#000000',
          icon: iconToCopy || '',
          mode: modeToCopy,
          routingProfile: routingProfileToCopy,
          routingService: routingServiceToCopy,
          segmentId: segmentId,
          newName: newValue
        });
        return true; // handled by offer
      }
    }
    return false; // not handled
  };

  const handleIconChange = (segmentId: string, _currentIcon: string | undefined, currentColor: string | undefined, newIcon: string) => {
    if (!newIcon) return false;

    let foundColor = trip.segments.find(s => s.id !== segmentId && s.transportMode === 'other' && s.customIcon === newIcon && s.customColor)?.customColor;
    if (!foundColor && allTrips) {
      for (const t of allTrips) {
        const match = t.segments.find(s => s.transportMode === 'other' && s.customIcon === newIcon && s.customColor);
        if (match) {
          foundColor = match.customColor;
          break;
        }
      }
    }
    if (foundColor && foundColor !== currentColor) {
      setSectionMetadataOffer({ color: foundColor, icon: newIcon, segmentId });
      return true; // handled by offer
    }
    return false; // not handled
  };

  const applySectionMetadataOffer = (targetSegmentId?: string) => {
    if (sectionMetadataOffer) {
      const newSegments = trip.segments.map(s => {
        if (s.id === (targetSegmentId || sectionMetadataOffer.segmentId)) {
          return { 
            ...s, 
            customColor: sectionMetadataOffer.color,
            ...(sectionMetadataOffer.newName ? {
              name: sectionMetadataOffer.newName,
              customIcon: sectionMetadataOffer.icon,
              transportMode: sectionMetadataOffer.mode as any,
              ...(sectionMetadataOffer.routingService ? { routingService: sectionMetadataOffer.routingService } : {}),
              ...(sectionMetadataOffer.routingProfile ? { routingProfile: sectionMetadataOffer.routingProfile } : {})
            } : {})
          };
        }
        return s;
      });
      onUpdateTrip({ ...trip, segments: newSegments });
      setSectionMetadataOffer(null);
    }
  };

  const cancelSectionMetadataOffer = () => {
    if (sectionMetadataOffer && sectionMetadataOffer.newName && sectionMetadataOffer.segmentId) {
      // If we cancel the new name offer, we just update the name
      const newSegments = trip.segments.map(s => {
        if (s.id === sectionMetadataOffer.segmentId) {
          return { ...s, name: sectionMetadataOffer.newName };
        }
        return s;
      });
      onUpdateTrip({ ...trip, segments: newSegments });
    }
    setSectionMetadataOffer(null);
  };

  return {
    sectionMetadataOffer,
    setSectionMetadataOffer,
    applySectionMetadataOffer,
    cancelSectionMetadataOffer,
    handleNameChange,
    handleIconChange
  };
}
