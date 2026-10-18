import type { CarSize } from "./types";

/** Illustrative models per DEFRA size class, for UI hints only (never used in calculations).
 *  DEFRA size limits (2019 methodology, Table 15): petrol small <1.4 L, medium 1.4-2.0 L, large >2.0 L;
 *  diesel small <1.7 L, medium 1.7-2.0 L, large >2.0 L. For electric cars the size is the vehicle class. */
export const CAR_SIZE_EXAMPLES: Record<Exclude<CarSize, "average">, { fuelBased: string[]; electric: string[] }> = {
  small: { fuelBased: ["Volkswagen Polo", "Ford Fiesta", "Toyota Yaris"], electric: ["Renault Zoe", "Fiat 500e", "Peugeot e-208"] },
  medium: { fuelBased: ["Volkswagen Golf", "Skoda Octavia", "Toyota Corolla"], electric: ["Volkswagen ID.3", "Tesla Model 3", "Hyundai Kona Electric"] },
  large: { fuelBased: ["Volvo XC90", "BMW 5 Series (3.0 L)", "Range Rover"], electric: ["Tesla Model X", "Audi e-tron", "Mercedes EQS"] },
};
