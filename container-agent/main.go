package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
	"github.com/docker/go-connections/nat"
)

const (
	managedLabel = "org.sisr.managed"
	matchLabel   = "org.sisr.match_id"
	serverPort   = "25565/tcp"
)

type Config struct {
	ListenAddr         string
	PodmanHost         string
	NetworkName        string
	MatchImage         string
	WorkerAPIBase      string
	AgentServiceToken  string
	GameAPIToken       string
	MemoryBytes        int64
	MemorySwapBytes    int64
	CPUPeriod          int64
	CPUQuota           int64
	MatchTimeout       time.Duration
	StopGrace          time.Duration
	ViewDistance       int
	SimulationDistance int
	PregenRadius       int
	JVMFlags           []string
}

type Agent struct {
	cfg        Config
	docker     *client.Client
	httpClient *http.Client

	mu             sync.RWMutex
	matches        map[string]*MatchContainer
	containerMatch map[string]string
}

type MatchContainer struct {
	MatchID       string    `json:"matchId"`
	ContainerID   string    `json:"containerId"`
	ContainerName string    `json:"containerName"`
	ServerName    string    `json:"serverName"`
	Address       string    `json:"address"`
	StartedAt     time.Time `json:"startedAt"`
	Stopping      bool      `json:"-"`
}

type StartRequest struct {
	MatchID            string   `json:"matchId"`
	Players            []string `json:"players"`
	TargetItem         string   `json:"targetItem"`
	WorldSeed          string   `json:"worldSeed"`
	ViewDistance       int      `json:"viewDistance"`
	SimulationDistance int      `json:"simulationDistance"`
	JVMFlags           []string `json:"jvmFlags"`
}

type StartResponse struct {
	ServerName string `json:"serverName"`
	Address    string `json:"address"`
}

type StopRequest struct {
	MatchID string `json:"matchId"`
}

type ExitNotification struct {
	MatchID     string `json:"matchId"`
	ServerName  string `json:"serverName"`
	ContainerID string `json:"containerId"`
	Reason      string `json:"reason"`
	ExitCode    *int   `json:"exitCode,omitempty"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	dockerClient, err := client.NewClientWithOpts(client.WithHost(cfg.PodmanHost), client.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatal(err)
	}

	agent := &Agent{
		cfg:            cfg,
		docker:         dockerClient,
		httpClient:     &http.Client{Timeout: 5 * time.Second},
		matches:        map[string]*MatchContainer{},
		containerMatch: map[string]string{},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go agent.watchEvents(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", agent.handleHealth)
	mux.HandleFunc("POST /match/start", agent.handleStart)
	mux.HandleFunc("POST /match/stop", agent.handleStop)

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("sisr agent listening on %s, podman=%s, image=%s, network=%s", cfg.ListenAddr, cfg.PodmanHost, cfg.MatchImage, cfg.NetworkName)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func (a *Agent) handleHealth(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	matches := make([]MatchContainer, 0, len(a.matches))
	for _, match := range a.matches {
		matches = append(matches, *match)
	}
	a.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"activeMatches": len(matches),
		"matches":       matches,
		"image":         a.cfg.MatchImage,
		"network":       a.cfg.NetworkName,
	})
}

func (a *Agent) handleStart(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var input StartRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	input.MatchID = strings.TrimSpace(input.MatchID)
	input.TargetItem = strings.TrimSpace(input.TargetItem)
	if input.MatchID == "" || input.TargetItem == "" || len(input.Players) == 0 {
		writeError(w, http.StatusBadRequest, "matchId, targetItem, and players are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	match, err := a.startMatch(ctx, input)
	if err != nil {
		log.Printf("start match %s failed: %v", input.MatchID, err)
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, StartResponse{ServerName: match.ServerName, Address: match.Address})
}

func (a *Agent) handleStop(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var input StopRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	input.MatchID = strings.TrimSpace(input.MatchID)
	if input.MatchID == "" {
		writeError(w, http.StatusBadRequest, "matchId is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), a.cfg.StopGrace+10*time.Second)
	defer cancel()

	stopped, err := a.stopMatch(ctx, input.MatchID, true)
	if err != nil {
		log.Printf("stop match %s failed: %v", input.MatchID, err)
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": stopped})
}

func (a *Agent) startMatch(ctx context.Context, input StartRequest) (*MatchContainer, error) {
	a.mu.RLock()
	if existing := a.matches[input.MatchID]; existing != nil {
		defer a.mu.RUnlock()
		return existing, nil
	}
	a.mu.RUnlock()

	serverName := serverNameForMatch(input.MatchID)
	address := serverName + ":25565"
	if existing, err := a.inspectExisting(ctx, input.MatchID, serverName, address); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	viewDistance := firstPositive(input.ViewDistance, a.cfg.ViewDistance)
	simulationDistance := firstPositive(input.SimulationDistance, a.cfg.SimulationDistance)
	jvmFlags := input.JVMFlags
	if len(jvmFlags) == 0 {
		jvmFlags = a.cfg.JVMFlags
	}
	initMemory, maxMemory, jvmOpts := splitJVMFlags(jvmFlags)

	env := []string{
		"MATCH_ID=" + input.MatchID,
		"TARGET_ITEM=" + input.TargetItem,
		"WORLD_SEED=" + input.WorldSeed,
		"LEVEL_SEED=" + input.WorldSeed,
		"ALLOWED_UUIDS=" + strings.Join(input.Players, ","),
		"VIEW_DISTANCE=" + strconv.Itoa(viewDistance),
		"SIMULATION_DISTANCE=" + strconv.Itoa(simulationDistance),
		"JVM_FLAGS=" + strings.Join(jvmFlags, " "),
		"INIT_MEMORY=" + initMemory,
		"MAX_MEMORY=" + maxMemory,
		"JVM_OPTS=" + strings.Join(jvmOpts, " "),
		"API_BASE=" + a.cfg.WorkerAPIBase,
		"API_TOKEN=" + a.cfg.GameAPIToken,
		"SERVER_ADDRESS=" + address,
		"MATCH_TIMEOUT_SECONDS=" + strconv.Itoa(int(a.cfg.MatchTimeout.Seconds())),
		"PREGEN_RADIUS=" + strconv.Itoa(a.cfg.PregenRadius),
		"EULA=TRUE",
		"TYPE=FABRIC",
		"ONLINE_MODE=FALSE",
		"ENFORCE_SECURE_PROFILE=FALSE",
		"PREVENT_PROXY_CONNECTIONS=FALSE",
		"MAX_PLAYERS=" + strconv.Itoa(len(input.Players)),
		"SPAWN_PROTECTION=0",
		"ALLOW_FLIGHT=TRUE",
	}

	created, err := a.docker.ContainerCreate(ctx,
		&container.Config{
			Image:        a.cfg.MatchImage,
			Env:          env,
			Labels:       map[string]string{managedLabel: "true", matchLabel: input.MatchID},
			ExposedPorts: nat.PortSet{nat.Port(serverPort): struct{}{}},
		},
		&container.HostConfig{
			AutoRemove:  true,
			NetworkMode: container.NetworkMode(a.cfg.NetworkName),
			Resources: container.Resources{
				Memory:     a.cfg.MemoryBytes,
				MemorySwap: a.cfg.MemorySwapBytes,
				CPUPeriod:  a.cfg.CPUPeriod,
				CPUQuota:   a.cfg.CPUQuota,
			},
		},
		&network.NetworkingConfig{
			EndpointsConfig: map[string]*network.EndpointSettings{
				a.cfg.NetworkName: {Aliases: []string{serverName}},
			},
		},
		nil,
		serverName,
	)
	if err != nil {
		return nil, fmt.Errorf("create container: %w", err)
	}

	if err := a.docker.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		_ = a.docker.ContainerRemove(context.Background(), created.ID, container.RemoveOptions{Force: true})
		return nil, fmt.Errorf("start container: %w", err)
	}

	match := &MatchContainer{
		MatchID:       input.MatchID,
		ContainerID:   created.ID,
		ContainerName: serverName,
		ServerName:    serverName,
		Address:       address,
		StartedAt:     time.Now().UTC(),
	}
	a.track(match)
	a.scheduleTimeout(input.MatchID)
	log.Printf("started match %s as %s at %s", input.MatchID, serverName, address)
	return match, nil
}

func (a *Agent) inspectExisting(ctx context.Context, matchID string, serverName string, address string) (*MatchContainer, error) {
	inspect, err := a.docker.ContainerInspect(ctx, serverName)
	if err != nil {
		if errdefs.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("inspect existing container: %w", err)
	}
	if inspect.State == nil || !inspect.State.Running {
		if err := a.docker.ContainerRemove(ctx, inspect.ID, container.RemoveOptions{Force: true}); err != nil && !errdefs.IsNotFound(err) {
			return nil, fmt.Errorf("remove stale container: %w", err)
		}
		return nil, nil
	}

	match := &MatchContainer{
		MatchID:       matchID,
		ContainerID:   inspect.ID,
		ContainerName: serverName,
		ServerName:    serverName,
		Address:       address,
		StartedAt:     time.Now().UTC(),
	}
	a.track(match)
	a.scheduleTimeout(matchID)
	log.Printf("reused running match %s as %s", matchID, serverName)
	return match, nil
}

func (a *Agent) stopMatch(ctx context.Context, matchID string, expected bool) (bool, error) {
	serverName := serverNameForMatch(matchID)

	a.mu.Lock()
	match := a.matches[matchID]
	if match == nil {
		match = &MatchContainer{MatchID: matchID, ContainerID: serverName, ContainerName: serverName, ServerName: serverName, Address: serverName + ":25565"}
	} else {
		match.Stopping = expected
	}
	a.mu.Unlock()

	timeout := int(a.cfg.StopGrace.Seconds())
	if err := a.docker.ContainerStop(ctx, match.ContainerID, container.StopOptions{Timeout: &timeout}); err != nil && !errdefs.IsNotFound(err) {
		return false, fmt.Errorf("stop container: %w", err)
	}
	if err := a.docker.ContainerRemove(ctx, match.ContainerID, container.RemoveOptions{Force: true}); err != nil && !errdefs.IsNotFound(err) {
		return false, fmt.Errorf("remove container: %w", err)
	}

	a.untrack(matchID, match.ContainerID)
	log.Printf("stopped match %s", matchID)
	return true, nil
}

func (a *Agent) scheduleTimeout(matchID string) {
	time.AfterFunc(a.cfg.MatchTimeout+a.cfg.StopGrace, func() {
		a.mu.RLock()
		match := a.matches[matchID]
		if match == nil || match.Stopping {
			a.mu.RUnlock()
			return
		}
		copy := *match
		a.mu.RUnlock()

		log.Printf("match %s exceeded hard timeout", matchID)
		a.notifyExit(context.Background(), &copy, "timeout", nil)

		ctx, cancel := context.WithTimeout(context.Background(), a.cfg.StopGrace+10*time.Second)
		defer cancel()
		if _, err := a.stopMatch(ctx, matchID, true); err != nil {
			log.Printf("timeout cleanup for match %s failed: %v", matchID, err)
		}
	})
}

func (a *Agent) watchEvents(ctx context.Context) {
	for {
		args := filters.NewArgs(filters.Arg("type", "container"), filters.Arg("label", managedLabel+"=true"))
		messages, errs := a.docker.Events(ctx, events.ListOptions{Filters: args})
	stream:
		for {
			select {
			case <-ctx.Done():
				return
			case err, ok := <-errs:
				if ok && err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("container event stream ended: %v", err)
				}
				break stream
			case message, ok := <-messages:
				if !ok {
					break stream
				}
				if isExitEvent(string(message.Action)) || isExitEvent(message.Status) {
					a.handleExitEvent(message)
				}
			}
		}
		if ctx.Err() != nil {
			return
		}
		time.Sleep(2 * time.Second)
	}
}

func (a *Agent) handleExitEvent(message events.Message) {
	matchID := message.Actor.Attributes[matchLabel]
	if matchID == "" {
		matchID = a.matchIDByContainer(message.Actor.ID)
	}
	if matchID == "" {
		return
	}

	a.mu.Lock()
	match := a.matches[matchID]
	if match == nil {
		a.mu.Unlock()
		serverName := message.Actor.Attributes["name"]
		if serverName == "" {
			serverName = serverNameForMatch(matchID)
		}
		copy := MatchContainer{
			MatchID:       matchID,
			ContainerID:   message.Actor.ID,
			ContainerName: serverName,
			ServerName:    serverName,
			Address:       serverName + ":25565",
			StartedAt:     time.Now().UTC(),
		}
		exitCode := parseOptionalInt(message.Actor.Attributes["exitCode"])
		a.notifyExit(context.Background(), &copy, eventReason(message), exitCode)
		return
	}
	if match.Stopping {
		containerID := match.ContainerID
		a.untrackLocked(matchID, containerID)
		a.mu.Unlock()
		return
	}
	match.Stopping = true
	copy := *match
	a.untrackLocked(matchID, match.ContainerID)
	a.mu.Unlock()

	exitCode := parseOptionalInt(message.Actor.Attributes["exitCode"])
	a.notifyExit(context.Background(), &copy, eventReason(message), exitCode)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.docker.ContainerRemove(ctx, copy.ContainerID, container.RemoveOptions{Force: true}); err != nil && !errdefs.IsNotFound(err) {
		log.Printf("remove exited container %s failed: %v", copy.ContainerID, err)
	}
}

func eventReason(message events.Message) string {
	reason := string(message.Action)
	if reason == "" {
		reason = message.Status
	}
	if reason == "" {
		return "exited"
	}
	return reason
}

func (a *Agent) notifyExit(ctx context.Context, match *MatchContainer, reason string, exitCode *int) {
	if a.cfg.WorkerAPIBase == "" || a.cfg.GameAPIToken == "" {
		return
	}

	body, err := json.Marshal(ExitNotification{
		MatchID:     match.MatchID,
		ServerName:  match.ServerName,
		ContainerID: match.ContainerID,
		Reason:      reason,
		ExitCode:    exitCode,
	})
	if err != nil {
		log.Printf("marshal exit notification for match %s failed: %v", match.MatchID, err)
		return
	}

	endpoint := strings.TrimRight(a.cfg.WorkerAPIBase, "/") + "/api/match/" + url.PathEscape(match.MatchID) + "/exit"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		log.Printf("build exit notification for match %s failed: %v", match.MatchID, err)
		return
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+a.cfg.GameAPIToken)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		log.Printf("exit notification for match %s failed: %v", match.MatchID, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("exit notification for match %s returned HTTP %d", match.MatchID, resp.StatusCode)
	}
}

func (a *Agent) authorized(r *http.Request) bool {
	expected := strings.TrimSpace(a.cfg.AgentServiceToken)
	if expected == "" {
		return true
	}
	if token := bearerToken(r.Header.Get("authorization")); token == expected {
		return true
	}
	return r.Header.Get("x-service-token") == expected
}

func (a *Agent) track(match *MatchContainer) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.matches[match.MatchID] = match
	a.containerMatch[match.ContainerID] = match.MatchID
}

func (a *Agent) untrack(matchID string, containerID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.untrackLocked(matchID, containerID)
}

func (a *Agent) untrackLocked(matchID string, containerID string) {
	delete(a.matches, matchID)
	delete(a.containerMatch, containerID)
}

func (a *Agent) matchIDByContainer(containerID string) string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.containerMatch[containerID]
}

func loadConfig() (Config, error) {
	podmanHost := env("PODMAN_HOST", env("DOCKER_HOST", ""))
	if podmanHost == "" {
		if runtimeDir := os.Getenv("XDG_RUNTIME_DIR"); runtimeDir != "" {
			podmanHost = "unix://" + strings.TrimRight(runtimeDir, "/") + "/podman/podman.sock"
		} else {
			podmanHost = "unix:///run/podman/podman.sock"
		}
	}

	memoryBytes, err := parseBytes(env("MATCH_MEMORY", "768m"))
	if err != nil {
		return Config{}, fmt.Errorf("MATCH_MEMORY: %w", err)
	}
	memorySwapBytes, err := parseBytes(env("MATCH_MEMORY_SWAP", env("MATCH_MEMORY", "768m")))
	if err != nil {
		return Config{}, fmt.Errorf("MATCH_MEMORY_SWAP: %w", err)
	}
	matchTimeout, err := time.ParseDuration(env("MATCH_TIMEOUT", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("MATCH_TIMEOUT: %w", err)
	}
	stopGrace, err := time.ParseDuration(env("STOP_GRACE", "30s"))
	if err != nil {
		return Config{}, fmt.Errorf("STOP_GRACE: %w", err)
	}
	cpuQuota := envInt64("MATCH_CPU_QUOTA", 150000)
	if cpus := strings.TrimSpace(os.Getenv("MATCH_CPUS")); cpus != "" {
		parsed, err := strconv.ParseFloat(cpus, 64)
		if err != nil {
			return Config{}, fmt.Errorf("MATCH_CPUS: %w", err)
		}
		cpuQuota = int64(parsed * 100000)
	}

	agentToken := env("AGENT_SERVICE_TOKEN", env("SERVICE_TOKEN", ""))
	gameToken := env("GAME_API_TOKEN", env("SERVICE_API_TOKEN", agentToken))

	return Config{
		ListenAddr:         env("LISTEN_ADDR", ":8080"),
		PodmanHost:         podmanHost,
		NetworkName:        env("PODMAN_NETWORK", env("RIR_NETWORK", "rir-net")),
		MatchImage:         env("MATCH_IMAGE", "rir-game:latest"),
		WorkerAPIBase:      strings.TrimRight(env("WORKER_API_BASE", env("API_BASE", "")), "/"),
		AgentServiceToken:  agentToken,
		GameAPIToken:       gameToken,
		MemoryBytes:        memoryBytes,
		MemorySwapBytes:    memorySwapBytes,
		CPUPeriod:          envInt64("MATCH_CPU_PERIOD", 100000),
		CPUQuota:           cpuQuota,
		MatchTimeout:       matchTimeout,
		StopGrace:          stopGrace,
		ViewDistance:       envInt("VIEW_DISTANCE", 6),
		SimulationDistance: envInt("SIMULATION_DISTANCE", 4),
		PregenRadius:       envInt("PREGEN_RADIUS", 12),
		JVMFlags:           splitWords(env("JVM_FLAGS", "-Xms200m -Xmx480m -XX:+UseG1GC -XX:MaxGCPauseMillis=50")),
	}, nil
}

func serverNameForMatch(matchID string) string {
	sum := sha256.Sum256([]byte(matchID))
	return "match-" + hex.EncodeToString(sum[:6])
}

func bearerToken(header string) string {
	parts := strings.Fields(header)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return parts[1]
	}
	return ""
}

func isExitEvent(action string) bool {
	switch action {
	case "die", "exited", "oom":
		return true
	default:
		return false
	}
}

func parseOptionalInt(value string) *int {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return nil
	}
	return &parsed
}

func firstPositive(first int, fallback int) int {
	if first > 0 {
		return first
	}
	return fallback
}

func parseBytes(value string) (int64, error) {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return 0, fmt.Errorf("empty size")
	}
	multiplier := int64(1)
	for suffix, factor := range map[string]int64{"k": 1024, "kb": 1024, "m": 1024 * 1024, "mb": 1024 * 1024, "g": 1024 * 1024 * 1024, "gb": 1024 * 1024 * 1024} {
		if strings.HasSuffix(trimmed, suffix) {
			multiplier = factor
			trimmed = strings.TrimSuffix(trimmed, suffix)
			break
		}
	}
	number, err := strconv.ParseFloat(strings.TrimSpace(trimmed), 64)
	if err != nil {
		return 0, err
	}
	return int64(number * float64(multiplier)), nil
}

func splitWords(value string) []string {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return nil
	}
	return fields
}

func splitJVMFlags(flags []string) (string, string, []string) {
	initMemory := "200M"
	maxMemory := "480M"
	opts := make([]string, 0, len(flags))
	for _, flag := range flags {
		if strings.HasPrefix(flag, "-Xms") {
			initMemory = javaMemoryValue(strings.TrimPrefix(flag, "-Xms"), initMemory)
			continue
		}
		if strings.HasPrefix(flag, "-Xmx") {
			maxMemory = javaMemoryValue(strings.TrimPrefix(flag, "-Xmx"), maxMemory)
			continue
		}
		opts = append(opts, flag)
	}
	return initMemory, maxMemory, opts
}

func javaMemoryValue(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	last := trimmed[len(trimmed)-1]
	if last == 'm' || last == 'g' || last == 'k' {
		return trimmed[:len(trimmed)-1] + strings.ToUpper(string(last))
	}
	return trimmed
}

func env(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt64(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write JSON response failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}
