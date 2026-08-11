import { useState } from 'react';
import type { Trip, TransportMode } from '../../../shared/types';
import { getModeColor } from './builtInModesPreferences';
import { routingManager } from '../routing/RoutingService';
import { getCustomOtherModes } from './customModesPreferences';

export interface CopySegmentMetadataData {
  color: string;
  icon: string;
  mode?: string;
  routingService?: string;
  routingProfile?: string;
  segmentId?: string;
  newName?: string;
}

export function useCopySegmentMetadata(trip: Trip, allTrips: Trip[] | undefined, onUpdateTrip: (newTrip: Trip) => void) {
  const [sectionMetadataOffer, setSectionMetadataOffer] = useState<CopySegmentMetadataData | null>(null);

  const handleNameChange = (segmentId: string, currentName: string | undefined, newValue: string) => {
    if (newValue !== (currentName || '') && newValue.trim() !== '') {
      let colorToCopy: string | undefined;
      let iconToCopy: string | undefined;
      let modeToCopy: string | undefined;
      let routingProfileToCopy: string | undefined;
      let routingServiceToCopy: string | undefined;

      const current = trip.segments.find(s => s.id === segmentId);
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

      if (routingServiceToCopy === 'gpx' && modeToCopy) {
         if (modeToCopy === 'other' && iconToCopy) {
            const cm = getCustomOtherModes().find(m => m.icon === iconToCopy);
            if (cm && cm.routingProfile) {
              const [svc, prof] = cm.routingProfile.split('|');
              routingServiceToCopy = svc;
              routingProfileToCopy = prof;
            } else {
              const defaultRouter = routingManager.getDefaultRouter(modeToCopy as TransportMode);
              routingServiceToCopy = defaultRouter.serviceName;
              routingProfileToCopy = defaultRouter.profile;
            }
         } else {
            const defaultRouter = routingManager.getDefaultRouter(modeToCopy as TransportMode);
            routingServiceToCopy = defaultRouter.serviceName;
            routingProfileToCopy = defaultRouter.profile;
         }
      }

      const actualColorToCopy = colorToCopy || getModeColor(modeToCopy as any) || '#000000';
      const currentColor = current?.customColor || getModeColor(current?.transportMode as any) || '#000000';
      const anyDifference =
        (actualColorToCopy !== currentColor) ||
        (iconToCopy && iconToCopy !== current?.customIcon) ||
        (modeToCopy && modeToCopy !== current?.transportMode) ||
        (routingProfileToCopy && routingProfileToCopy !== current?.routingProfile) ||
        (routingServiceToCopy && routingServiceToCopy !== current?.routingService);
      if (modeToCopy && anyDifference) {
        setSectionMetadataOffer({
          color: actualColorToCopy,
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
              ...(sectionMetadataOffer.routingService ? { routingService: sectionMetadataOffer.routingService, source: (sectionMetadataOffer.routingService === 'gpx' ? 'gpx' : 'router') as 'gpx' | 'router' } : {}),
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
