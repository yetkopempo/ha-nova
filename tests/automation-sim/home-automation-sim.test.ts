import { describe, expect, it } from "vitest";

import {
  createBaseState,
  runEastVeluxFollowSun,
  runVeluxHeatAiringOpen,
  runVeluxHeatStop,
  runVeluxNoRequestClose,
  runVeluxScheduledAiringClose,
  runVeluxScheduledAiringOpen,
  runWeatherSafetyRetractSensitive,
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
    expect(result.state.ventilationRequest).toBe(true);
    expect(result.state.airingTimerActive).toBe(true);
    expect(new Set(windowModes(result.state))).toEqual(new Set(["open"]));
  });

  it("blocks scheduled airing when any prerequisite gate fails", () => {
    const blockedStates = [
      createBaseState({ cooldownActive: true, co2: 980 }),
      createBaseState({ weatherUnsafeForShades: true, co2: 980 }),
      createBaseState({ severeWeather: true, co2: 980 }),
      createBaseState({ precipitation: 0.1, co2: 980 }),
      createBaseState({ insideTemp: 20, outsideTemp: 21, co2: 980 }),
      createBaseState({ outsideTemp: 24, insideTemp: 25, co2: 980 }),
      createBaseState({ timeWithinScheduledWindow: false, co2: 980 }),
      createBaseState({ co2: 800 }),
    ];

    for (const state of blockedStates) {
      const result = runVeluxScheduledAiringOpen(state);
      expect(result.actions).toEqual([]);
      expect(result.state.ventilationRequest).toBe(false);
      expect(result.state.airingTimerActive).toBe(false);
      expect(new Set(windowModes(result.state))).toEqual(new Set(["closed"]));
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
        precipitation: 0.2,
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

  it("drops wide-open windows to flap on storm/rain instead of forcing full close", () => {
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

  it.fails("does not spam repeated flap commands and cooldown restarts on repeated no-request close ticks", () => {
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

  it.fails("does not spam repeated flap commands on repeated unsafe-weather close ticks", () => {
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

  it.fails("does not spam repeated open commands on heat-airing ticks when the cooling cycle is already active", () => {
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

  it.fails("does not spam repeated open commands on scheduled-airing ticks when the ventilation cycle is already active", () => {
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
});
