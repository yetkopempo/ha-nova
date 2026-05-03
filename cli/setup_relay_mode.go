package main

import (
	"bufio"
	"fmt"
	"io"
	"net/url"
	"strings"
)

const (
	relayModeAddon      = "addon"
	relayModeStandalone = "standalone"
)

type setupRelayModeChoice struct {
	Number string
	Value  string
	Label  string
}

func normalizeRelayMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case relayModeAddon:
		return relayModeAddon
	case relayModeStandalone:
		return relayModeStandalone
	default:
		return ""
	}
}

func setupRelayMode(cfg runtimeConfig) string {
	if mode := normalizeRelayMode(cfg.RelayMode); mode != "" {
		return mode
	}
	return relayModeAddon
}

func setupUsesStandaloneRelay(cfg runtimeConfig) bool {
	return setupRelayMode(cfg) == relayModeStandalone
}

func applySetupRelayMode(cfg runtimeConfig, relayMode string) (runtimeConfig, error) {
	if strings.TrimSpace(relayMode) == "" {
		return cfg, nil
	}
	normalized := normalizeRelayMode(relayMode)
	if normalized == "" {
		return cfg, fmt.Errorf("invalid relay mode %q; use addon or standalone", relayMode)
	}
	cfg.RelayMode = normalized
	return cfg, nil
}

func defaultRelayBaseURLForSetup(cfg runtimeConfig) string {
	if value := strings.TrimSpace(cfg.RelayBaseURL); value != "" {
		return strings.TrimRight(value, "/")
	}
	return deriveRelayURLFromHA(cfg.HAURL, cfg.HAHost)
}

func resolveRelayBaseURLInput(input string) (string, error) {
	normalized := strings.TrimSpace(strings.TrimRight(input, "/"))
	if normalized == "" {
		return "", fmt.Errorf("missing relay base URL")
	}
	if !strings.HasPrefix(normalized, "http://") && !strings.HasPrefix(normalized, "https://") {
		normalized = "http://" + normalized
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return "", fmt.Errorf("invalid relay base URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid relay base URL: %s", input)
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func promptSetupRelayModeFromReader(reader *bufio.Reader, out io.Writer, defaultMode string) (string, error) {
	choices := []setupRelayModeChoice{
		{Number: "1", Value: relayModeAddon, Label: "Install in Home Assistant (Supervisor add-on)"},
		{Number: "2", Value: relayModeStandalone, Label: "Use an existing standalone relay (Docker / NAS / Home Assistant Container)"},
	}
	defaultChoice := "1"
	if normalizeRelayMode(defaultMode) == relayModeStandalone {
		defaultChoice = "2"
	}

	for {
		fmt.Fprintln(out)
		fmt.Fprintln(out, "  How do you want to run NOVA Relay?")
		fmt.Fprintln(out)
		for _, choice := range choices {
			fmt.Fprintf(out, "    %s) %s\n", choice.Number, choice.Label)
		}
		fmt.Fprintln(out)
		fmt.Fprintf(out, "  Enter [%s-%s] (default %s, or type 'back'/'exit'): ", choices[0].Number, choices[len(choices)-1].Number, defaultChoice)

		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		line = strings.ToLower(strings.TrimSpace(line))
		switch line {
		case "":
			line = defaultChoice
		case "back":
			return "", errSetupBack
		case "exit":
			return "", errSetupExit
		}

		for _, choice := range choices {
			if line == choice.Number || line == choice.Value {
				return choice.Value, nil
			}
		}
		renderSetupErrorLine(out, "Invalid choice. Please enter one of the listed options.")
	}
}

func promptStandaloneRelayBaseURLFromReader(reader *bufio.Reader, out io.Writer, defaultURL string) (string, error) {
	currentDefault := strings.TrimSpace(defaultURL)
	for {
		input, err := promptWizardLineFromReader(reader, out, "Relay base URL (for example http://nas-box:8791)", currentDefault)
		if err != nil {
			return "", err
		}
		relayURL, err := resolveRelayBaseURLInput(input)
		if err == nil {
			return relayURL, nil
		}
		renderSetupErrorLine(out, "%s", err)
		currentDefault = strings.TrimSpace(input)
	}
}

func relaySettingsChoiceLabel(cfg runtimeConfig) string {
	if setupUsesStandaloneRelay(cfg) {
		return "Show standalone relay config checklist"
	}
	return "Open NOVA Relay settings"
}

func renderStandaloneRelayChecklist(out io.Writer, cfg runtimeConfig) {
	relayURL := defaultRelayBaseURLForSetup(cfg)
	haURL := strings.TrimSpace(cfg.HAURL)
	lines := []string{
		`Set "RELAY_AUTH_TOKEN" to the relay token from this setup`,
		`Set "HA_LLAT" to a valid Home Assistant Long-Lived Access Token`,
	}
	if haURL != "" {
		lines = append(lines, fmt.Sprintf(`Set "HA_URL" to %s`, haURL))
	}
	if relayURL != "" {
		lines = append(lines, fmt.Sprintf("Make sure this device can reach the relay at %s", relayURL))
	}
	lines = append(lines, "Save the container config and restart the relay")
	renderSetupIndentedBlock(out, "Standalone relay checklist:", "    ", lines...)
}
