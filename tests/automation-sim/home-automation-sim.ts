export type ShadeMode = "open" | "closed";
export type WindowMode = "closed" | "flap" | "half" | "open";
export type VeluxCloseTrigger =
  | "outside_warmer"
  | "no_request"
  | "unsafe_weather"
  | "rain"
  | "startup";

export interface AutomationSimState {
  shadeAutoEnabled: boolean;
  shadeManualOverride: boolean;
  shadeEastEnabled: boolean;
  weatherSafetyEnabled: boolean;
  directSunEast: boolean;
  directSunWest: boolean;
  weatherUnsafeForShades: boolean;
  severeWeather: boolean;
  eastShades: ShadeMode;
  westVeluxShades: ShadeMode;
  summerConditions: boolean;
  coolingNeeded: boolean;
  heatingWelcome: boolean;
  insideTemp: number;
  outsideTemp: number;
  precipitation: number;
  globalRadiation: number;
  co2: number;
  timeWithinScheduledWindow: boolean;
  cooldownActive: boolean;
  airingTimerActive: boolean;
  intervalAiringToggle: boolean;
  ventilationRequest: boolean;
  coolingRequest: boolean;
  officeWindow: WindowMode;
  bathroomWindow: WindowMode;
  bathroomUpstairsWindow: WindowMode;
  guestRoomWindow: WindowMode;
}

export interface SimulationResult {
  state: AutomationSimState;
  actions: string[];
}

type WindowKey =
  | "officeWindow"
  | "bathroomWindow"
  | "bathroomUpstairsWindow"
  | "guestRoomWindow";

const AIRING_WINDOWS: WindowKey[] = [
  "officeWindow",
  "bathroomWindow",
  "bathroomUpstairsWindow",
  "guestRoomWindow",
];

export function createBaseState(
  partial: Partial<AutomationSimState> = {},
): AutomationSimState {
  return {
    shadeAutoEnabled: true,
    shadeManualOverride: false,
    shadeEastEnabled: true,
    weatherSafetyEnabled: true,
    directSunEast: false,
    directSunWest: false,
    weatherUnsafeForShades: false,
    severeWeather: false,
    eastShades: "open",
    westVeluxShades: "open",
    summerConditions: true,
    coolingNeeded: false,
    heatingWelcome: false,
    insideTemp: 24,
    outsideTemp: 20,
    precipitation: 0,
    globalRadiation: 120,
    co2: 450,
    timeWithinScheduledWindow: true,
    cooldownActive: false,
    airingTimerActive: false,
    intervalAiringToggle: false,
    ventilationRequest: false,
    coolingRequest: false,
    officeWindow: "closed",
    bathroomWindow: "closed",
    bathroomUpstairsWindow: "closed",
    guestRoomWindow: "closed",
    ...partial,
  };
}

export function runEastVeluxFollowSun(state: AutomationSimState): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (
    !next.shadeAutoEnabled ||
    next.shadeManualOverride ||
    !next.shadeEastEnabled ||
    next.weatherUnsafeForShades
  ) {
    return { state: next, actions };
  }

  if (next.directSunEast) {
    next.eastShades = "closed";
    actions.push("cover.close_cover:cover.east_shades");
  } else {
    next.eastShades = "open";
    actions.push("cover.open_cover:cover.east_shades");
  }

  return { state: next, actions };
}

export function runWeatherSafetyRetractSensitive(
  state: AutomationSimState,
): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (
    !next.shadeAutoEnabled ||
    !next.weatherSafetyEnabled ||
    !next.weatherUnsafeForShades
  ) {
    return { state: next, actions };
  }

  next.eastShades = "open";
  next.westVeluxShades = "open";
  actions.push("cover.open_cover:cover.east_shades");
  actions.push("cover.open_cover:cover.west_velux_shades");

  return { state: next, actions };
}

export function runVeluxScheduledAiringOpen(
  state: AutomationSimState,
): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (next.cooldownActive) return { state: next, actions };
  if (next.weatherUnsafeForShades) return { state: next, actions };
  if (next.severeWeather) return { state: next, actions };
  if (!(next.insideTemp > next.outsideTemp)) return { state: next, actions };
  if (!(next.outsideTemp < 24)) return { state: next, actions };
  if (!next.timeWithinScheduledWindow) return { state: next, actions };
  if (!(next.co2 > 800)) return { state: next, actions };

  const targetMode: WindowMode = next.precipitation > 0.1 ? "half" : "open";
  const allOpen = allWindowsMatch(next, targetMode);
  const ventilationCycleAlreadyActive =
    next.ventilationRequest && next.airingTimerActive && next.intervalAiringToggle;

  if (ventilationCycleAlreadyActive && allOpen) {
    return { state: next, actions };
  }

  if (!allOpen) {
    setAllAiringWindows(next, targetMode);
    actions.push(
      targetMode === "half"
        ? "cover.set_cover_position:velux_airing_windows:50"
        : "cover.open_cover:velux_airing_windows",
    );
  }
  if (!next.airingTimerActive) {
    next.airingTimerActive = true;
    actions.push("timer.start:timer.airing_timer");
  }
  if (!next.intervalAiringToggle) {
    next.intervalAiringToggle = true;
    actions.push("input_boolean.turn_on:input_boolean.interval_airing_toggle");
  }
  if (!next.ventilationRequest) {
    next.ventilationRequest = true;
    actions.push("input_boolean.turn_on:input_boolean.velux_request_ventilation");
  }

  return { state: next, actions };
}

export function runVeluxHeatAiringOpen(
  state: AutomationSimState,
): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  const seasonGate =
    (next.summerConditions && next.coolingNeeded) ||
    (!next.summerConditions && !next.heatingWelcome);
  if (!seasonGate) return { state: next, actions };
  if (next.cooldownActive) return { state: next, actions };
  if (next.weatherUnsafeForShades) return { state: next, actions };
  if (next.severeWeather) return { state: next, actions };
  if (!(next.insideTemp > next.outsideTemp)) return { state: next, actions };
  if (!(next.insideTemp > 23.5)) return { state: next, actions };
  if (!(temperatureDelta(next) >= 3)) return { state: next, actions };
  if (!(next.globalRadiation < 200)) return { state: next, actions };

  const eastFacadeReady = !next.directSunEast || next.eastShades === "open";
  const westFacadeReady = !next.directSunWest || next.westVeluxShades === "open";
  if (!eastFacadeReady || !westFacadeReady) {
    return { state: next, actions };
  }

  const targetMode: WindowMode = next.precipitation > 0.1 ? "half" : "open";
  const allOpen = allWindowsMatch(next, targetMode);
  if (next.coolingRequest && allOpen) {
    return { state: next, actions };
  }

  if (!allOpen) {
    setAllAiringWindows(next, targetMode);
    actions.push(
      targetMode === "half"
        ? "cover.set_cover_position:velux_airing_windows:50"
        : "cover.open_cover:velux_airing_windows",
    );
  }
  if (!next.coolingRequest) {
    next.coolingRequest = true;
    actions.push("input_boolean.turn_on:input_boolean.velux_request_cooling");
  }

  return { state: next, actions };
}

export function runVeluxHeatStop(state: AutomationSimState): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (!next.coolingRequest) return { state: next, actions };

  const stopBecauseDeltaSmall = temperatureDelta(next) < 1;
  const stopBecauseHeatingWelcome = next.heatingWelcome;
  const stopBecauseShoulderFloor = !next.summerConditions && next.insideTemp <= 22;

  if (
    !stopBecauseDeltaSmall &&
    !stopBecauseHeatingWelcome &&
    !stopBecauseShoulderFloor
  ) {
    return { state: next, actions };
  }

  if (next.ventilationRequest) {
    next.coolingRequest = false;
    actions.push("input_boolean.turn_off:input_boolean.velux_request_cooling");
    return { state: next, actions };
  }

  setAllAiringWindows(next, "closed");
  next.coolingRequest = false;
  next.cooldownActive = true;
  actions.push("cover.close_cover:velux_airing_windows");
  actions.push("input_boolean.turn_off:input_boolean.velux_request_cooling");
  actions.push("timer.start:timer.velux_airing_cooldown");

  return { state: next, actions };
}

export function runVeluxScheduledAiringClose(
  state: AutomationSimState,
): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (!next.intervalAiringToggle && !next.ventilationRequest) {
    return { state: next, actions };
  }

  next.airingTimerActive = false;
  actions.push("timer.cancel:timer.airing_timer");

  if (next.coolingRequest) {
    next.intervalAiringToggle = false;
    next.ventilationRequest = false;
    actions.push("input_boolean.turn_off:input_boolean.interval_airing_toggle");
    actions.push("input_boolean.turn_off:input_boolean.velux_request_ventilation");
    return { state: next, actions };
  }

  if (outsideWarmerOrEqual(next)) {
    setAllAiringWindows(next, "closed");
    next.intervalAiringToggle = false;
    next.ventilationRequest = false;
    next.cooldownActive = true;
    actions.push("cover.close_cover:velux_airing_windows");
    actions.push("input_boolean.turn_off:input_boolean.interval_airing_toggle");
    actions.push("input_boolean.turn_off:input_boolean.velux_request_ventilation");
    actions.push("timer.start:timer.velux_airing_cooldown");
    return { state: next, actions };
  }

  setAllAiringWindows(next, "flap");
  next.intervalAiringToggle = false;
  next.ventilationRequest = false;
  next.cooldownActive = true;
  actions.push("cover.set_cover_position:velux_airing_windows:11");
  actions.push("input_boolean.turn_off:input_boolean.interval_airing_toggle");
  actions.push("input_boolean.turn_off:input_boolean.velux_request_ventilation");
  actions.push("timer.start:timer.velux_airing_cooldown");

  return { state: next, actions };
}

export function runVeluxNoRequestClose(
  state: AutomationSimState,
  trigger: VeluxCloseTrigger,
): SimulationResult {
  const next = cloneState(state);
  const actions: string[] = [];

  if (!anyWindowAboveClosed(next)) {
    return { state: next, actions };
  }

  const noRequest = !next.ventilationRequest && !next.coolingRequest;
  if (!(trigger === "unsafe_weather" || trigger === "rain" || noRequest || outsideWarmerOrEqual(next))) {
    return { state: next, actions };
  }

  const forceFullClose =
    trigger === "outside_warmer" ||
    (trigger === "startup" && outsideWarmerOrEqual(next)) ||
    (trigger === "no_request" && outsideWarmerOrEqual(next));

  if (forceFullClose) {
    setAllAiringWindows(next, "closed");
    next.airingTimerActive = false;
    next.intervalAiringToggle = false;
    next.ventilationRequest = false;
    next.coolingRequest = false;
    actions.push("cover.close_cover:velux_airing_windows");
    actions.push("timer.cancel:timer.airing_timer");
    actions.push("input_boolean.turn_off:input_boolean.interval_airing_toggle");
    actions.push("input_boolean.turn_off:input_boolean.velux_request_ventilation");
    actions.push("input_boolean.turn_off:input_boolean.velux_request_cooling");
    return { state: next, actions };
  }

  if (trigger === "rain" && (next.ventilationRequest || next.coolingRequest)) {
    if (allWindowsMatch(next, "half")) {
      return { state: next, actions };
    }

    setAllAiringWindows(next, "half");
    actions.push("cover.set_cover_position:velux_airing_windows:50");
    return { state: next, actions };
  }

  if (allWindowsMatch(next, "flap")) {
    return { state: next, actions };
  }

  setAllAiringWindows(next, "flap");
  if (trigger === "no_request" && !next.cooldownActive) {
    next.cooldownActive = true;
    actions.push("timer.start:timer.velux_airing_cooldown");
  }
  actions.push("cover.set_cover_position:velux_airing_windows:11");
  return { state: next, actions };
}

export function windowModes(state: AutomationSimState): WindowMode[] {
  return AIRING_WINDOWS.map((key) => state[key]);
}

function cloneState(state: AutomationSimState): AutomationSimState {
  return { ...state };
}

function setAllAiringWindows(state: AutomationSimState, mode: WindowMode): void {
  for (const key of AIRING_WINDOWS) {
    state[key] = mode;
  }
}

function anyWindowAboveClosed(state: AutomationSimState): boolean {
  return AIRING_WINDOWS.some((key) => state[key] !== "closed");
}

function allWindowsMatch(state: AutomationSimState, mode: WindowMode): boolean {
  return AIRING_WINDOWS.every((key) => state[key] === mode);
}

function temperatureDelta(state: AutomationSimState): number {
  return state.insideTemp - state.outsideTemp;
}

function outsideWarmerOrEqual(state: AutomationSimState): boolean {
  return state.outsideTemp >= state.insideTemp;
}
