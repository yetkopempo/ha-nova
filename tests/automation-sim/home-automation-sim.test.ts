import { describe, expect, it } from "vitest";

import {
  computeDwellSeconds,
  computeEffectiveIrradianceThreshold,
  computeIrradianceGateWithHysteresis,
  computePrecipitationAllowsSunShadingGate,
  computeDreameBudgetOnStop,
  computeDreameRemainingBudget,
  computeWeatherSupportsSunShadingGate,
  createBaseState,
  decideAwayOnlyShade,
  runEastVeluxFollowSun,
  runVeluxHeatAiringOpen,
  runVeluxHeatStop,
  runVeluxNoRequestClose,
  runVeluxScheduledAiringClose,
  runVeluxScheduledAiringOpen,
  runWestInternalBlindFollowSun,
  runWeatherSafetyRetractSensitive,
  simulateShadeGroupCloseWithRetry,
  windowModes,
} from "./home-automation-sim.js";

describe("home automation simulation", () => {
  it("does not move east shades when automation is blocked by local guards", () => {
    const guardedStates = [
      createBaseState({ shadeAutoEnabled: false, directSunEast: true }),
      createBaseState({ shadeManualOverride: true, directSunEast: true }),
      createBaseState({ shadeEastEnabled: false, directSunEast: true }),
      createBaseState({ weatherUnsafeForShades: true, directSunEast: true }),
    ];

    for (const state of guardedStates) {
      const result = runEastVeluxFollowSun(state);
      expect(result.actions).toEqual([]);
      expect(result.state.eastShades).toBe(state.eastShades);
    }
  });

  it("closes east shades on direct sun and reopens them when direct sun ends", () => {
    const closeResult = runEastVeluxFollowSun(
      createBaseState({
        directSunEast: true,
        eastShades: "open",
      }),
    );

    expect(closeResult.actions).toEqual(["cover.close_cover:cover.east_shades"]);
    expect(closeResult.state.eastShades).toBe("closed");

    const openResult = runEastVeluxFollowSun(
      createBaseState({
        directSunEast: false,
        eastShades: "closed",
      }),
    );

    expect(openResult.actions).toEqual(["cover.open_cover:cover.east_shades"]);
    expect(openResult.state.eastShades).toBe("open");
  });

  it("retracts sensitive shades on unsafe weather", () => {
    const retractResult = runWeatherSafetyRetractSensitive(
      createBaseState({
        weatherUnsafeForShades: true,
        eastShades: "closed",
        westVeluxShades: "closed",
      }),
    );

    expect(retractResult.actions).toEqual([
      "cover.open_cover:cover.east_shades",
      "cover.open_cover:cover.west_velux_shades",
    ]);
    expect(retractResult.state.eastShades).toBe("open");
    expect(retractResult.state.westVeluxShades).toBe("open");
  });

  it("does not retract shades when safety automation is disabled or weather is still safe", () => {
    const blockedStates = [
      createBaseState({ shadeAutoEnabled: false, weatherUnsafeForShades: true }),
      createBaseState({ weatherSafetyEnabled: false, weatherUnsafeForShades: true }),
      createBaseState({ weatherUnsafeForShades: false }),
    ];

    for (const state of blockedStates) {
      const result = runWeatherSafetyRetractSensitive(state);
      expect(result.actions).toEqual([]);
      expect(result.state.eastShades).toBe(state.eastShades);
      expect(result.state.westVeluxShades).toBe(state.westVeluxShades);
    }
  });

  it("does not move west internal blinds when local guards block the automation", () => {
    const guardedStates = [
      createBaseState({ shadeAutoEnabled: false, sunOnWestGeom: true }),
      createBaseState({ shadeManualOverride: true, sunOnWestGeom: true }),
      createBaseState({ westInternalShadeEnabled: false, sunOnWestGeom: true }),
    ];

    for (const state of guardedStates) {
      const result = runWestInternalBlindFollowSun(state);
      expect(result.actions).toEqual([]);
      expect(result.state.westInternalBlinds).toBe(state.westInternalBlinds);
    }
  });

  it("does not close west internal blinds below the base-plus-offset irradiance threshold", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "sunny",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 350,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.westInternalBlinds).toBe("open");
  });

  it("closes west internal blinds only after the internal offset threshold is exceeded", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "sunny",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 800,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual(["cover.close_cover:cover.west_internal_blinds"]);
    expect(result.state.westInternalBlinds).toBe("closed");
  });

  it("does not spam repeated internal close commands when the blind is already closed", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "sunny",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 800,
        westInternalBlinds: "closed",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.westInternalBlinds).toBe("closed");
  });

  it("uses the cloudy threshold before adding the internal offset", () => {
    const belowCloudyThreshold = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "cloudy",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdCloudy: 500,
        irrThresholdInternalOffset: 500,
        globalRadiation: 800,
        westInternalBlinds: "open",
      }),
    );
    const atCloudyThreshold = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "cloudy",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdCloudy: 500,
        irrThresholdInternalOffset: 500,
        globalRadiation: 1000,
        westInternalBlinds: "open",
      }),
    );

    expect(belowCloudyThreshold.actions).toEqual([]);
    expect(belowCloudyThreshold.state.westInternalBlinds).toBe("open");
    expect(atCloudyThreshold.actions).toEqual([
      "cover.close_cover:cover.west_internal_blinds",
    ]);
    expect(atCloudyThreshold.state.westInternalBlinds).toBe("closed");
  });

  it("keeps partly-cloudy weather on the base threshold", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "partlycloudy",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdCloudy: 500,
        irrThresholdInternalOffset: 500,
        globalRadiation: 750,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual(["cover.close_cover:cover.west_internal_blinds"]);
  });

  it("does not close west internal blinds in rain even when irradiance is high", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "rainy",
        precipitation: 1.2,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 1000,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.westInternalBlinds).toBe("open");
  });

  it("does not close west internal blinds when west geometry is not active even if irradiance is high", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: false,
        summerConditions: true,
        coolingNeeded: true,
        weatherState: "sunny",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 1000,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.westInternalBlinds).toBe("open");
  });

  it("does not close west internal blinds off-season even if irradiance is high", () => {
    const result = runWestInternalBlindFollowSun(
      createBaseState({
        sunOnWestGeom: true,
        summerConditions: false,
        coolingNeeded: true,
        heatingWelcome: false,
        weatherState: "sunny",
        precipitation: 0,
        irrThreshold: 250,
        irrThresholdInternalOffset: 500,
        globalRadiation: 1000,
        westInternalBlinds: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.westInternalBlinds).toBe("open");
  });

  it("reopens west internal blinds immediately when weather or precipitation gate turns shading off", () => {
    const initial = createBaseState({
      sunOnWestGeom: true,
      summerConditions: true,
      coolingNeeded: true,
      weatherState: "sunny",
      precipitation: 0,
      irrThreshold: 250,
      irrThresholdInternalOffset: 500,
      globalRadiation: 900,
      westInternalBlinds: "open",
    });

    const closed = runWestInternalBlindFollowSun(initial);
    expect(closed.state.westInternalBlinds).toBe("closed");

    const reopenedByRain = runWestInternalBlindFollowSun({
      ...closed.state,
      weatherState: "rainy",
      precipitation: 1.0,
    });

    expect(reopenedByRain.actions).toEqual(["cover.open_cover:cover.west_internal_blinds"]);
    expect(reopenedByRain.state.westInternalBlinds).toBe("open");
  });

  it("opens scheduled airing on high CO2 and leaves a clear trace of the request state", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
      }),
    );

    expect(result.actions).toContain("cover.open_cover:velux_airing_windows");
    expect(result.actions).toContain("timer.start:timer.airing_timer");
    expect(result.actions).toContain("timer.duration:timer.airing_timer:90");
    expect(result.state.ventilationRequest).toBe(true);
    expect(result.state.airingTimerActive).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("does not start scheduled airing in rain even when weather is otherwise non-severe", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
        precipitation: 0.3,
        severeWeather: false,
        weatherUnsafeForShades: false,
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("does not start scheduled airing in heavier rain either", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
        precipitation: 3.2,
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("does not restart scheduled airing while any airing request is already active", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
        ventilationRequest: true,
        airingTimerActive: true,
        intervalAiringToggle: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("recovers the ventilation request without repeating already-completed open steps", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
        ventilationRequest: false,
        airingTimerActive: true,
        intervalAiringToggle: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toEqual([
      "input_boolean.turn_on:input_boolean.velux_request_ventilation",
    ]);
    expect(result.state.ventilationRequest).toBe(true);
    expect(result.state.airingTimerActive).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("blocks scheduled airing when any prerequisite gate fails", () => {
    const blockedStates = [
      createBaseState({ cooldownActive: true, co2: 980 }),
      createBaseState({ ventilationRequest: true, co2: 980 }),
      createBaseState({ coolingRequest: true, co2: 980 }),
      createBaseState({ weatherUnsafeForShades: true, co2: 980 }),
      createBaseState({ severeWeather: true, co2: 980 }),
      createBaseState({ insideTemp: 20, outsideTemp: 21, co2: 980 }),
      createBaseState({ outsideTemp: 24, insideTemp: 25, co2: 980 }),
      createBaseState({ timeWithinScheduledWindow: false, co2: 980 }),
      createBaseState({ co2: 800 }),
    ];

    for (const state of blockedStates) {
      const result = runVeluxScheduledAiringOpen(state);
      expect(result.actions).toEqual([]);
      expect(result.state).toEqual(state);
    }
  });

  it("lets ventilation and cooling requests coexist without forcing a pointless close-open cycle", () => {
    const bothRequests = createBaseState({
      ventilationRequest: true,
      coolingRequest: true,
      intervalAiringToggle: true,
      airingTimerActive: true,
      officeWindow: "open",
      bathroomWindow: "open",
      bathroomUpstairsWindow: "open",
      guestRoomWindow: "open",
      summerConditions: true,
      coolingNeeded: true,
      insideTemp: 27,
      outsideTemp: 22,
      globalRadiation: 120,
    });

    const scheduledClose = runVeluxScheduledAiringClose(bothRequests);
    expect(scheduledClose.state.ventilationRequest).toBe(false);
    expect(scheduledClose.state.coolingRequest).toBe(true);
    expect(new Set(windowModes(scheduledClose.state))).toEqual(new Set(["open"]));
    expect(scheduledClose.actions).not.toContain("cover.close_cover:velux_airing_windows");

    const heatStop = runVeluxHeatStop({
      ...bothRequests,
      insideTemp: 22.4,
      outsideTemp: 21.8,
    });
    expect(heatStop.state.coolingRequest).toBe(false);
    expect(heatStop.state.ventilationRequest).toBe(true);
    expect(new Set(windowModes(heatStop.state))).toEqual(new Set(["open"]));
    expect(heatStop.actions).not.toContain("cover.close_cover:velux_airing_windows");
  });

  it("uses the shorter ventilation cap when outside air is already cold", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 1200,
        insideTemp: 23.8,
        outsideTemp: 6,
      }),
    );

    expect(result.actions).toContain("timer.duration:timer.airing_timer:45");
  });

  it("keeps shoulder cooling active below 22C when tomorrow is forecast to be hot", () => {
    const result = runVeluxHeatStop(
      createBaseState({
        coolingRequest: true,
        summerConditions: false,
        coolingNeeded: true,
        heatingWelcome: false,
        tomorrowMaxTemp: 30,
        precoolTomorrowMaxTrigger: 26,
        insideTemp: 21.8,
        outsideTemp: 18,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.coolingRequest).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("moves windows to flap after pure ventilation when outside is still cooler", () => {
    const result = runVeluxScheduledAiringClose(
      createBaseState({
        ventilationRequest: true,
        intervalAiringToggle: true,
        airingTimerActive: true,
        insideTemp: 23,
        outsideTemp: 18,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["flap"]));
    expect(result.state.cooldownActive).toBe(true);
  });

  it("fully closes windows after pure ventilation when backflow would start", () => {
    const result = runVeluxScheduledAiringClose(
      createBaseState({
        ventilationRequest: true,
        intervalAiringToggle: true,
        airingTimerActive: true,
        insideTemp: 22.8,
        outsideTemp: 23,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toContain("cover.close_cover:velux_airing_windows");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["closed"]));
  });

  it("does nothing on scheduled close when there is no active scheduled cycle to finish", () => {
    const result = runVeluxScheduledAiringClose(createBaseState());
    expect(result.actions).toEqual([]);
  });

  it("keeps summer heat purge available but blocks it when heating is welcome", () => {
    const summerPurge = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
      }),
    );

    expect(summerPurge.actions).toContain("cover.open_cover:velux_airing_windows");
    expect(summerPurge.state.coolingRequest).toBe(true);

    const blocked = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: false,
        coolingNeeded: false,
        heatingWelcome: true,
        insideTemp: 24.5,
        outsideTemp: 20,
      }),
    );

    expect(blocked.actions).toEqual([]);
    expect(blocked.state.coolingRequest).toBe(false);
  });

  it("does not start heat purge in rain even when weather is otherwise non-severe", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        precipitation: 0.3,
        severeWeather: false,
        weatherUnsafeForShades: false,
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("does not start heat purge in heavier rain either", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        precipitation: 3.2,
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("does not try to reopen heat purge during rain when cooling is already active", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        precipitation: 0.3,
        coolingRequest: true,
        officeWindow: "flap",
        bathroomWindow: "flap",
        bathroomUpstairsWindow: "flap",
        guestRoomWindow: "flap",
      }),
    );

    expect(result.actions).toEqual([]);
  });

  it("marks cooling request active when windows are already fully open for heat purge", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        coolingRequest: false,
      }),
    );

    expect(result.actions).not.toContain("cover.open_cover:velux_airing_windows");
    expect(result.actions).toContain("input_boolean.turn_on:input_boolean.velux_request_cooling");
    expect(result.state.coolingRequest).toBe(true);
  });

  it("reopens windows for heat purge when request is active but windows are no longer at target", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        officeWindow: "flap",
        bathroomWindow: "flap",
        bathroomUpstairsWindow: "flap",
        guestRoomWindow: "flap",
        coolingRequest: true,
      }),
    );

    expect(result.actions).toContain("cover.open_cover:velux_airing_windows");
    expect(result.actions).not.toContain("input_boolean.turn_on:input_boolean.velux_request_cooling");
  });

  it("blocks heat airing on every important guard path before opening windows", () => {
    const blockedStates = [
      createBaseState({
        summerConditions: true,
        coolingNeeded: false,
        heatingWelcome: false,
        insideTemp: 27,
        outsideTemp: 22,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        cooldownActive: true,
        insideTemp: 27,
        outsideTemp: 22,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        weatherUnsafeForShades: true,
        insideTemp: 27,
        outsideTemp: 22,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        severeWeather: true,
        insideTemp: 27,
        outsideTemp: 22,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 22,
        outsideTemp: 22,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 23.5,
        outsideTemp: 20,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 25,
        outsideTemp: 22.5,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 27,
        outsideTemp: 22,
        globalRadiation: 250,
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 27,
        outsideTemp: 22,
        directSunEast: true,
        eastShades: "closed",
      }),
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        insideTemp: 27,
        outsideTemp: 22,
        directSunWest: true,
        westVeluxShades: "closed",
      }),
    ];

    for (const state of blockedStates) {
      const result = runVeluxHeatAiringOpen(state);
      expect(result.actions).toEqual([]);
      expect(result.state.coolingRequest).toBe(false);
    }
  });

  it("does nothing on heat-stop when cooling is inactive or cooling still has clear benefit", () => {
    const inactive = runVeluxHeatStop(createBaseState({ coolingRequest: false }));
    expect(inactive.actions).toEqual([]);

    const stillUseful = runVeluxHeatStop(
      createBaseState({
        coolingRequest: true,
        summerConditions: true,
        heatingWelcome: false,
        insideTemp: 27,
        outsideTemp: 22,
      }),
    );

    expect(stillUseful.actions).toEqual([]);
    expect(stillUseful.state.coolingRequest).toBe(true);
  });

  it("fully closes windows when heat purge stops and no ventilation request is still active", () => {
    const result = runVeluxHeatStop(
      createBaseState({
        coolingRequest: true,
        insideTemp: 24.5,
        outsideTemp: 24,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toContain("cover.close_cover:velux_airing_windows");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["closed"]));
    expect(result.state.cooldownActive).toBe(true);
  });

  it("stops cooling in shoulder mode when the room floor is reached", () => {
    const result = runVeluxHeatStop(
      createBaseState({
        coolingRequest: true,
        summerConditions: false,
        heatingWelcome: false,
        insideTemp: 21.8,
        outsideTemp: 18,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toContain("cover.close_cover:velux_airing_windows");
    expect(result.state.coolingRequest).toBe(false);
  });

  it("stops ventilation by CO2 target without waiting for the cold-weather time cap", () => {
    const result = runVeluxScheduledAiringClose(
      createBaseState({
        ventilationRequest: true,
        intervalAiringToggle: true,
        airingTimerActive: true,
        co2: 480,
        ventilationTargetCo2: 500,
        insideTemp: 22.5,
        outsideTemp: 14,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(result.state.ventilationRequest).toBe(false);
  });

  it("forces full close from flap mode when outside gets warmer later", () => {
    const result = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "flap",
        bathroomWindow: "flap",
        bathroomUpstairsWindow: "flap",
        guestRoomWindow: "flap",
        insideTemp: 22.4,
        outsideTemp: 23.2,
      }),
      "outside_warmer",
    );

    expect(result.actions).toContain("cover.close_cover:velux_airing_windows");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["closed"]));
  });

  it("fully closes on startup self-heal when outside is already warmer", () => {
    const result = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "flap",
        bathroomWindow: "flap",
        bathroomUpstairsWindow: "flap",
        guestRoomWindow: "flap",
        insideTemp: 21,
        outsideTemp: 22,
      }),
      "startup",
    );

    expect(result.actions).toContain("cover.close_cover:velux_airing_windows");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["closed"]));
  });

  it("drops startup leftovers to flap when there is no request and outside is still cooler", () => {
    const result = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        ventilationRequest: false,
        coolingRequest: false,
        insideTemp: 23,
        outsideTemp: 18,
      }),
      "startup",
    );

    expect(result.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(new Set(windowModes(result.state))).toEqual(new Set(["flap"]));
  });

  it("drops wide-open windows to flap on storm instead of forcing full close", () => {
    const storm = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "unsafe_weather",
    );

    expect(storm.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(new Set(windowModes(storm.state))).toEqual(new Set(["flap"]));
  });

  it("drops windows to flap on rain while a pure ventilation request is still active", () => {
    const rain = runVeluxNoRequestClose(
      createBaseState({
        ventilationRequest: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "rain",
    );

    expect(rain.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(new Set(windowModes(rain.state))).toEqual(new Set(["flap"]));
  });

  it("drops windows to flap on rain while a pure cooling request is still active", () => {
    const rain = runVeluxNoRequestClose(
      createBaseState({
        coolingRequest: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "rain",
    );

    expect(rain.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(new Set(windowModes(rain.state))).toEqual(new Set(["flap"]));
  });

  it("does not switch rainy ventilation into rainy heat purge", () => {
    const ventilationRain = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 24,
        outsideTemp: 20,
        precipitation: 0.3,
        severeWeather: false,
        weatherUnsafeForShades: false,
      }),
    );

    const heatRain = runVeluxHeatAiringOpen({
      ...ventilationRain.state,
      summerConditions: true,
      coolingNeeded: true,
      heatingWelcome: false,
      globalRadiation: 80,
      insideTemp: 27,
      outsideTemp: 22,
    });

    expect(ventilationRain.actions).toEqual([]);
    expect(heatRain.actions).toEqual([]);
  });

  it("does nothing on rain if request-driven windows are already at flap", () => {
    const rain = runVeluxNoRequestClose(
      createBaseState({
        coolingRequest: true,
        officeWindow: "flap",
        bathroomWindow: "flap",
        bathroomUpstairsWindow: "flap",
        guestRoomWindow: "flap",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "rain",
    );

    expect(rain.actions).toEqual([]);
  });

  it("blocks immediate reopen while cooldown is active even if demand is otherwise strong", () => {
    const scheduled = runVeluxScheduledAiringOpen(
      createBaseState({
        cooldownActive: true,
        co2: 980,
        insideTemp: 24,
        outsideTemp: 20,
      }),
    );

    const heat = runVeluxHeatAiringOpen(
      createBaseState({
        cooldownActive: true,
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        insideTemp: 27,
        outsideTemp: 22,
        globalRadiation: 80,
      }),
    );

    expect(scheduled.actions).toEqual([]);
    expect(heat.actions).toEqual([]);
  });

  it("still drops windows to flap on rain when no ventilation request is active", () => {
    const rain = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "rain",
    );

    expect(new Set(windowModes(rain.state))).toEqual(new Set(["flap"]));
  });

  it("does nothing in no-request close when every window is already closed", () => {
    const result = runVeluxNoRequestClose(createBaseState(), "no_request");
    expect(result.actions).toEqual([]);
  });

  it("ignores no-request close when requests are still active and there is no forcing trigger", () => {
    const result = runVeluxNoRequestClose(
      createBaseState({
        ventilationRequest: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "startup",
    );

    expect(result.actions).toEqual([]);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("drops windows to flap and starts cooldown after a no-request transition while outside is still cooler", () => {
    const result = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "no_request",
    );

    expect(result.actions).toContain("cover.set_cover_position:velux_airing_windows:11");
    expect(result.actions).toContain("timer.start:timer.velux_airing_cooldown");
    expect(result.state.cooldownActive).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["flap"]));
  });

  it("does not reopen from flap during cooldown even if heat-airing demand still holds on the next tick", () => {
    const cooledToFlap = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "no_request",
    );

    const nextTick = runVeluxHeatAiringOpen({
      ...cooledToFlap.state,
      summerConditions: true,
      coolingNeeded: true,
      heatingWelcome: false,
      insideTemp: 27,
      outsideTemp: 22,
      globalRadiation: 80,
    });

    expect(nextTick.actions).toEqual([]);
    expect(nextTick.state.coolingRequest).toBe(false);
    expect(nextTick.state.cooldownActive).toBe(true);
    expect(new Set(windowModes(nextTick.state))).toEqual(new Set(["flap"]));
  });

  it("does not reopen from fully closed during cooldown even if heat-airing demand still holds on the next tick", () => {
    const fullyClosed = runVeluxHeatStop(
      createBaseState({
        coolingRequest: true,
        insideTemp: 24.5,
        outsideTemp: 24,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    const nextTick = runVeluxHeatAiringOpen({
      ...fullyClosed.state,
      summerConditions: true,
      coolingNeeded: true,
      heatingWelcome: false,
      insideTemp: 27,
      outsideTemp: 22,
      globalRadiation: 80,
    });

    expect(nextTick.actions).toEqual([]);
    expect(nextTick.state.coolingRequest).toBe(false);
    expect(nextTick.state.cooldownActive).toBe(true);
    expect(new Set(windowModes(nextTick.state))).toEqual(new Set(["closed"]));
  });

  it("does not spam repeated flap commands and cooldown restarts on repeated no-request close ticks", () => {
    const firstClose = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "no_request",
    );

    const secondClose = runVeluxNoRequestClose(firstClose.state, "no_request");

    expect(secondClose.actions).toEqual([]);
    expect(secondClose.state.cooldownActive).toBe(true);
    expect(new Set(windowModes(secondClose.state))).toEqual(new Set(["flap"]));
  });

  it("does not spam repeated flap commands on repeated unsafe-weather close ticks", () => {
    const firstClose = runVeluxNoRequestClose(
      createBaseState({
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
        insideTemp: 24,
        outsideTemp: 18,
      }),
      "unsafe_weather",
    );

    const secondClose = runVeluxNoRequestClose(firstClose.state, "unsafe_weather");

    expect(secondClose.actions).toEqual([]);
    expect(new Set(windowModes(secondClose.state))).toEqual(new Set(["flap"]));
  });

  it("does not spam repeated open commands on heat-airing ticks when the cooling cycle is already active", () => {
    const result = runVeluxHeatAiringOpen(
      createBaseState({
        summerConditions: true,
        coolingNeeded: true,
        heatingWelcome: false,
        coolingRequest: true,
        insideTemp: 27.2,
        outsideTemp: 22.4,
        globalRadiation: 80,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.coolingRequest).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("does not spam repeated open commands on scheduled-airing ticks when the ventilation cycle is already active", () => {
    const result = runVeluxScheduledAiringOpen(
      createBaseState({
        co2: 980,
        insideTemp: 23.8,
        outsideTemp: 20.1,
        ventilationRequest: true,
        airingTimerActive: true,
        intervalAiringToggle: true,
        officeWindow: "open",
        bathroomWindow: "open",
        bathroomUpstairsWindow: "open",
        guestRoomWindow: "open",
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.state.ventilationRequest).toBe(true);
    expect(result.state.airingTimerActive).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("consumes the shared Dreame drying budget from wall-clock time after a fresh start", () => {
    const result = computeDreameBudgetOnStop({
      doneOffset: 0,
      freshStartTimestamp: 0,
      resumeStartTimestamp: 0,
      nowTimestamp: 0,
    });
    expect(result.newOffset).toBe(0);
    expect(result.remainingSeconds).toBe(10800);

    const ninetyMinutes = computeDreameBudgetOnStop({
      doneOffset: 0,
      freshStartTimestamp: 1_000,
      nowTimestamp: 1_000 + 5_400,
    });

    expect(ninetyMinutes.elapsedSeconds).toBe(5400);
    expect(ninetyMinutes.elapsedPercent).toBe(50);
    expect(ninetyMinutes.newOffset).toBe(50);
    expect(ninetyMinutes.remainingPercent).toBe(50);
    expect(ninetyMinutes.remainingSeconds).toBe(5400);
    expect(ninetyMinutes.remainingHms).toBe("01:30:00");
  });

  it("continues spending the same Dreame budget after resume and clamps at 100 percent", () => {
    const resumed = computeDreameBudgetOnStop({
      doneOffset: 50,
      resumeStartTimestamp: 2_000,
      nowTimestamp: 2_000 + 1_800,
    });

    expect(resumed.elapsedPercent).toBe(17);
    expect(resumed.newOffset).toBe(67);
    expect(resumed.remainingPercent).toBe(33);
    expect(resumed.remainingHms).toBe("00:59:24");

    const overrun = computeDreameBudgetOnStop({
      doneOffset: 80,
      resumeStartTimestamp: 3_000,
      nowTimestamp: 3_000 + 10_800,
    });

    expect(overrun.newOffset).toBe(100);
    expect(overrun.remainingPercent).toBe(0);
    expect(overrun.remainingSeconds).toBe(0);
    expect(overrun.remainingHms).toBe("00:00:00");
  });

  it("computes the remaining Dreame drying budget directly from the shared offset", () => {
    const result = computeDreameRemainingBudget(67);

    expect(result.newOffset).toBe(67);
    expect(result.remainingPercent).toBe(33);
    expect(result.remainingSeconds).toBe(3564);
    expect(result.remainingHms).toBe("00:59:24");
  });

  it("keeps the irradiance gate on through a small dip once the gate is already active", () => {
    const result = computeIrradianceGateWithHysteresis({
      currentIrradiance: 430,
      onThreshold: 500,
      offDelta: 150,
      wasOn: true,
    });

    expect(result.offThreshold).toBe(350);
    expect(result.isOn).toBe(true);
  });

  it("turns the irradiance gate off only once irradiance falls below the lower off threshold", () => {
    const result = computeIrradianceGateWithHysteresis({
      currentIrradiance: 323,
      onThreshold: 500,
      offDelta: 150,
      wasOn: true,
    });

    expect(result.offThreshold).toBe(350);
    expect(result.isOn).toBe(false);
  });

  it("still requires the full on threshold to activate from an off state", () => {
    const belowOn = computeIrradianceGateWithHysteresis({
      currentIrradiance: 430,
      onThreshold: 500,
      offDelta: 150,
      wasOn: false,
    });
    const aboveOn = computeIrradianceGateWithHysteresis({
      currentIrradiance: 733,
      onThreshold: 500,
      offDelta: 150,
      wasOn: false,
    });

    expect(belowOn.isOn).toBe(false);
    expect(aboveOn.isOn).toBe(true);
  });

  it("holds the irradiance gate through transient unavailable samples", () => {
    expect(
      computeIrradianceGateWithHysteresis({
        currentIrradiance: "unavailable",
        onThreshold: 500,
        offDelta: 150,
        wasOn: true,
      }).isOn,
    ).toBe(true);
    expect(
      computeIrradianceGateWithHysteresis({
        currentIrradiance: "unknown",
        onThreshold: 500,
        offDelta: 150,
        wasOn: false,
      }).isOn,
    ).toBe(false);
  });

  it("uses the elevated threshold only for cloudy weather", () => {
    expect(computeEffectiveIrradianceThreshold("cloudy", 250, 500)).toBe(500);
    expect(computeEffectiveIrradianceThreshold("cloudy", 600, 500)).toBe(600);
    expect(computeEffectiveIrradianceThreshold("partlycloudy", 250, 500)).toBe(250);
    expect(computeEffectiveIrradianceThreshold("sunny", 250, 500)).toBe(250);
  });

  it("holds weather and precipitation gates through transient unavailable samples", () => {
    expect(computeWeatherSupportsSunShadingGate("unavailable", true)).toBe(true);
    expect(computeWeatherSupportsSunShadingGate("unknown", false)).toBe(false);
    expect(computeWeatherSupportsSunShadingGate("sunny", false)).toBe(true);
    expect(computeWeatherSupportsSunShadingGate("rainy", true)).toBe(false);
    expect(computePrecipitationAllowsSunShadingGate("unavailable", true)).toBe(true);
    expect(computePrecipitationAllowsSunShadingGate("unknown", false)).toBe(false);
    expect(computePrecipitationAllowsSunShadingGate(0.1, false)).toBe(true);
    expect(computePrecipitationAllowsSunShadingGate(0.2, true)).toBe(false);
  });

  it("converts dashboard dwell minutes to seconds with a twelve-minute fallback", () => {
    expect(computeDwellSeconds(12)).toBe(720);
    expect(computeDwellSeconds(7)).toBe(420);
    expect(computeDwellSeconds("unavailable")).toBe(720);
    expect(computeDwellSeconds(Number.NaN)).toBe(720);
  });

  it("opens away-only shades for occupancy and closes only after away plus dwell", () => {
    expect(decideAwayOnlyShade(true, true, 90, true)).toBe("open");
    expect(decideAwayOnlyShade(false, true, 90, false)).toBe("hold");
    expect(decideAwayOnlyShade(false, false, 90, true)).toBe("open");
    expect(decideAwayOnlyShade(false, true, 29, true)).toBe("hold");
    expect(decideAwayOnlyShade(false, true, 30, true)).toBe("close");
  });

  it("retries a failed group close once and records a final failure", () => {
    expect(
      simulateShadeGroupCloseWithRetry({
        firstAttemptClosed: true,
        retryAttemptClosed: false,
      }),
    ).toEqual(["cover.close_cover:group"]);
    expect(
      simulateShadeGroupCloseWithRetry({
        firstAttemptClosed: false,
        retryAttemptClosed: true,
      }),
    ).toEqual([
      "cover.close_cover:group",
      "delay:00:01:00",
      "cover.close_cover:group:retry",
      "log:retry",
    ]);
    expect(
      simulateShadeGroupCloseWithRetry({
        firstAttemptClosed: false,
        retryAttemptClosed: false,
      }),
    ).toContain("log:close_failed");
  });
});
