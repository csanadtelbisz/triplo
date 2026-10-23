import type { DataBundle } from "./data";
import { defaultData } from "./generated/data";
import { calcBus } from "./bus";
import { calcCar } from "./car";
import { calcFerry } from "./ferry";
import { calcFlight } from "./flight";
import { calcRail } from "./rail";
import { Run, yearOf } from "./run";
import type { BatchItem, ClimateResult, TravelInput } from "./types";

export interface Calculator {
  calculate(input: TravelInput): ClimateResult;
  /** One bad item never breaks the batch. */
  calculateMany(inputs: TravelInput[]): BatchItem[];
}

export function makeCalculator(data: DataBundle): Calculator {
  function calculate(input: TravelInput): ClimateResult {
    if (input.mode === "none") {
      return new Run(data, new Date().getFullYear()).finish({ directKg: 0, upstreamKg: 0, method: "none", includesRadiativeForcing: false, distanceKmUsed: 0 });
    }
    const run = new Run(data, yearOf(input.date));
    switch (input.mode) {
      case "flight": return calcFlight(run, input);
      case "car": return calcCar(run, input);
      case "bus": return calcBus(run, input);
      case "rail": return calcRail(run, input);
      case "ferry": return calcFerry(run, input);
      default: throw new Error(`Unsupported mode ${(input as { mode: string }).mode}`);
    }
  }
  function calculateMany(inputs: TravelInput[]): BatchItem[] {
    return inputs.map((i): BatchItem => {
      try {
        return { ok: true, result: calculate(i) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }
  return { calculate, calculateMany };
}

const def = makeCalculator(defaultData);
export const calculate = def.calculate;
export const calculateMany = def.calculateMany;
