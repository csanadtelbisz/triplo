import { createContext } from 'react';
import type { Trip } from '../../../shared/types';

/** Loaded trips supply usage rankings to every climate editor, including dialogs. */
export const FlightProfileTripsContext = createContext<readonly Trip[]>([]);
