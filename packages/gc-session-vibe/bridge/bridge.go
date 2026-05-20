package vibeexec

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	defaultBaseURL         = "http://127.0.0.1:4020"
	defaultStateDirName    = "gc-session-vibe"
	defaultDeleteOnStop    = false
	watchConnectTimeout    = 30 * time.Second
	watchReadTimeout       = 2 * time.Second
	peekHydrationTimeout   = 1500 * time.Millisecond
	watcherStatusRunning   = "running"
	watcherStatusCompleted = "completed"
)

type startConfig struct {
	WorkDir      string            `json:"work_dir,omitempty"`
	Env          map[string]string `json:"env,omitempty"`
	Nudge        string            `json:"nudge,omitempty"`
	ProcessNames []string          `json:"process_names,omitempty"`
}

type executorConfig struct {
	Executor         string  `json:"executor"`
	Variant          *string `json:"variant,omitempty"`
	ModelID          *string `json:"model_id,omitempty"`
	AgentID          *string `json:"agent_id,omitempty"`
	ReasoningID      *string `json:"reasoning_id,omitempty"`
	PermissionPolicy *string `json:"permission_policy,omitempty"`
}

type bridgeConfig struct {
	BaseURL               string
	RepoMatch             string
	TargetBranch          string
	DeleteWorkspaceOnStop bool
	StateRoot             string
	AdoptWorkspaceID      string
	AdoptSessionID        string
	SessionLabel          string
	WorkingDir            string
	ExecutorConfig        executorConfig
}

type repo struct {
	ID                  string `json:"id"`
	Path                string `json:"path"`
	Name                string `json:"name"`
	DisplayName         string `json:"display_name"`
	DefaultTargetBranch string `json:"default_target_branch"`
}

type repoInput struct {
	RepoID       string `json:"repo_id"`
	TargetBranch string `json:"target_branch"`
}

type workspace struct {
	ID           string  `json:"id"`
	ContainerRef *string `json:"container_ref"`
	Branch       string  `json:"branch"`
	Name         *string `json:"name"`
}

type executionProcess struct {
	ID        string  `json:"id"`
	SessionID string  `json:"session_id"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	StartedAt string  `json:"started_at"`
	Completed *string `json:"completed_at"`
}

type sessionState struct {
	SessionName            string            `json:"session_name"`
	Active                 bool              `json:"active"`
	GCWorkDir              string            `json:"gc_work_dir,omitempty"`
	VibeBaseURL            string            `json:"vibe_base_url"`
	VibeRepoMatch          string            `json:"vibe_repo_match"`
	VibeRepoID             string            `json:"vibe_repo_id,omitempty"`
	VibeRepoName           string            `json:"vibe_repo_name,omitempty"`
	VibeRepoPath           string            `json:"vibe_repo_path,omitempty"`
	VibeTargetBranch       string            `json:"vibe_target_branch,omitempty"`
	VibeWorkspaceID        string            `json:"vibe_workspace_id,omitempty"`
	VibeWorkspacePath      string            `json:"vibe_workspace_path,omitempty"`
	VibeSessionID          string            `json:"vibe_session_id,omitempty"`
	VibeWorkingDir         string            `json:"vibe_working_dir,omitempty"`
	VibeSessionLabel       string            `json:"vibe_session_label,omitempty"`
	LatestExecutionID      string            `json:"latest_execution_id,omitempty"`
	LatestExecutionStatus  string            `json:"latest_execution_status,omitempty"`
	LastWatchedExecutionID string            `json:"last_watched_execution_id,omitempty"`
	LastActivityAt         string            `json:"last_activity_at,omitempty"`
	Meta                   map[string]string `json:"meta,omitempty"`
	ExecutorConfig         executorConfig    `json:"executor_config"`
}

type apiResponse[T any] struct {
	Success   bool    `json:"success"`
	Data      *T      `json:"data"`
	ErrorData *T      `json:"error_data"`
	Message   *string `json:"message"`
}

type startWorkspaceRequest struct {
	Name           *string        `json:"name"`
	Repos          []repoInput    `json:"repos"`
	LinkedIssue    any            `json:"linked_issue"`
	ExecutorConfig executorConfig `json:"executor_config"`
	Prompt         string         `json:"prompt"`
	AttachmentIDs  any            `json:"attachment_ids"`
}

type startWorkspaceResponse struct {
	Workspace        workspace        `json:"workspace"`
	ExecutionProcess executionProcess `json:"execution_process"`
}

type followUpRequest struct {
	Prompt          string         `json:"prompt"`
	ExecutorConfig  executorConfig `json:"executor_config"`
	WorkingDir      *string        `json:"working_dir,omitempty"`
	RetryProcessID  any            `json:"retry_process_id"`
	ForceWhenDirty  any            `json:"force_when_dirty"`
	PerformGitReset any            `json:"perform_git_reset"`
}

type updateSessionRequest struct {
	Name string `json:"name"`
}

type normalizedPatchEnvelope struct {
	Type    string          `json:"type"`
	Content json.RawMessage `json:"content"`
}

type patchOp struct {
	Path  string                  `json:"path"`
	Value normalizedPatchEnvelope `json:"value"`
}

type normalizedEntry struct {
	Content string `json:"content"`
}

type runner struct {
	env          map[string]string
	stdin        io.Reader
	stdout       io.Writer
	stderr       io.Writer
	now          func() time.Time
	httpClient   *http.Client
	spawnWatcher func(sessionName, executionID string) error
}

func Run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	r := &runner{
		env:        environmentMap(os.Environ()),
		stdin:      stdin,
		stdout:     stdout,
		stderr:     stderr,
		now:        time.Now().UTC,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	r.spawnWatcher = func(sessionName, executionID string) error {
		return spawnWatcherProcess(sessionName, executionID)
	}
	if err := r.run(args); err != nil {
		fmt.Fprintln(stderr, err.Error())
		if errors.Is(err, errUnknownOperation) {
			return 2
		}
		return 1
	}
	return 0
}

var errUnknownOperation = errors.New("unknown operation")

func (r *runner) run(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("missing operation")
	}
	op := args[0]
	name := ""
	if len(args) > 1 {
		name = args[1]
	}

	switch op {
	case "start":
		cfg, err := decodeStartConfig(r.stdin)
		if err != nil {
			return fmt.Errorf("start: decode config: %w", err)
		}
		return r.handleStart(name, cfg)
	case "stop":
		return r.handleStop(name)
	case "interrupt":
		return r.handleInterrupt(name)
	case "is-running":
		return r.handleIsRunning(name)
	case "process-alive":
		return r.handleProcessAlive(name)
	case "nudge":
		data, err := io.ReadAll(r.stdin)
		if err != nil {
			return fmt.Errorf("nudge: read stdin: %w", err)
		}
		return r.handleNudge(name, strings.TrimSpace(string(data)))
	case "set-meta":
		if len(args) < 3 {
			return fmt.Errorf("set-meta: missing key")
		}
		data, err := io.ReadAll(r.stdin)
		if err != nil {
			return fmt.Errorf("set-meta: read stdin: %w", err)
		}
		return r.handleSetMeta(name, args[2], string(data))
	case "get-meta":
		if len(args) < 3 {
			return fmt.Errorf("get-meta: missing key")
		}
		return r.handleGetMeta(name, args[2])
	case "remove-meta":
		if len(args) < 3 {
			return fmt.Errorf("remove-meta: missing key")
		}
		return r.handleRemoveMeta(name, args[2])
	case "peek":
		lines := 0
		if len(args) > 2 {
			parsed, err := strconv.Atoi(args[2])
			if err == nil {
				lines = parsed
			}
		}
		return r.handlePeek(name, lines)
	case "list-running":
		return r.handleListRunning(name)
	case "get-last-activity":
		return r.handleGetLastActivity(name)
	case "clear-scrollback":
		return r.handleClearScrollback(name)
	case "watch-execution":
		if len(args) < 3 {
			return fmt.Errorf("watch-execution: missing execution id")
		}
		return r.handleWatchExecution(name, args[2])
	case "watch-startup", "attach", "copy-to", "send-keys":
		return errUnknownOperation
	default:
		return errUnknownOperation
	}
}

func (r *runner) handleStart(name string, cfg startConfig) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("start: missing session name")
	}
	bridgeCfg, err := r.loadBridgeConfig(cfg.Env)
	if err != nil {
		return fmt.Errorf("start: %w", err)
	}
	state, err := r.loadState(name)
	if err != nil {
		return fmt.Errorf("start: load state: %w", err)
	}
	if state != nil && state.Active {
		return fmt.Errorf("session %q already exists", name)
	}
	prompt := strings.TrimSpace(cfg.Nudge)
	if state != nil && state.VibeSessionID != "" && state.VibeWorkspaceID != "" {
		state.Active = true
		state.GCWorkDir = cfg.WorkDir
		state.VibeBaseURL = bridgeCfg.BaseURL
		state.VibeRepoMatch = bridgeCfg.RepoMatch
		state.VibeTargetBranch = bridgeCfg.TargetBranch
		if strings.TrimSpace(bridgeCfg.WorkingDir) != "" {
			state.VibeWorkingDir = strings.TrimSpace(bridgeCfg.WorkingDir)
		}
		if strings.TrimSpace(bridgeCfg.SessionLabel) != "" {
			state.VibeSessionLabel = strings.TrimSpace(bridgeCfg.SessionLabel)
			if err := r.updateSessionName(state.VibeBaseURL, state.VibeSessionID, state.VibeSessionLabel); err != nil {
				fmt.Fprintf(r.stderr, "warning: update session name: %v\n", err)
			}
		}
		state.ExecutorConfig = bridgeCfg.ExecutorConfig
		if state.Meta == nil {
			state.Meta = map[string]string{}
		}
		if prompt != "" {
			execProc, err := r.followUp(state, prompt)
			if err != nil {
				return fmt.Errorf("start: reuse follow-up: %w", err)
			}
			updateExecutionState(state, execProc, r.now())
		}
		if err := r.ensureSymlink(cfg.WorkDir, state.VibeWorkspacePath); err != nil {
			return fmt.Errorf("start: refresh workdir symlink: %w", err)
		}
		if err := r.saveState(state); err != nil {
			return fmt.Errorf("start: save reused state: %w", err)
		}
		if state.LatestExecutionID != "" {
			if err := r.maybeSpawnWatcher(name, state, state.LatestExecutionID); err != nil {
				fmt.Fprintf(r.stderr, "warning: start watcher: %v\n", err)
			}
		}
		return nil
	}

	if strings.TrimSpace(bridgeCfg.AdoptWorkspaceID) != "" {
		if strings.TrimSpace(bridgeCfg.AdoptSessionID) == "" {
			return fmt.Errorf("start: missing VIBE_ADOPT_SESSION_ID")
		}
		ws, err := r.getWorkspace(strings.TrimSpace(bridgeCfg.AdoptWorkspaceID), bridgeCfg.BaseURL)
		if err != nil {
			return fmt.Errorf("start: load adopted workspace: %w", err)
		}
		workspacePath := derefString(ws.ContainerRef)
		if workspacePath == "" {
			return fmt.Errorf("start: workspace %s has empty container_ref", ws.ID)
		}
		if err := r.ensureSymlink(cfg.WorkDir, workspacePath); err != nil {
			return fmt.Errorf("start: create workdir symlink: %w", err)
		}
		state = &sessionState{
			SessionName:       name,
			Active:            true,
			GCWorkDir:         cfg.WorkDir,
			VibeBaseURL:       bridgeCfg.BaseURL,
			VibeRepoMatch:     bridgeCfg.RepoMatch,
			VibeTargetBranch:  bridgeCfg.TargetBranch,
			VibeWorkspaceID:   ws.ID,
			VibeWorkspacePath: workspacePath,
			VibeSessionID:     strings.TrimSpace(bridgeCfg.AdoptSessionID),
			VibeWorkingDir:    strings.TrimSpace(bridgeCfg.WorkingDir),
			VibeSessionLabel:  strings.TrimSpace(bridgeCfg.SessionLabel),
			Meta:              map[string]string{},
			ExecutorConfig:    bridgeCfg.ExecutorConfig,
		}
		if state.VibeSessionLabel != "" {
			if err := r.updateSessionName(state.VibeBaseURL, state.VibeSessionID, state.VibeSessionLabel); err != nil {
				fmt.Fprintf(r.stderr, "warning: update session name: %v\n", err)
			}
		}
		if prompt != "" {
			execProc, err := r.followUp(state, prompt)
			if err != nil {
				return fmt.Errorf("start: bootstrap follow-up: %w", err)
			}
			updateExecutionState(state, execProc, r.now())
		}
		if err := r.saveState(state); err != nil {
			return fmt.Errorf("start: save adopted state: %w", err)
		}
		if state.LatestExecutionID != "" {
			if err := r.maybeSpawnWatcher(name, state, state.LatestExecutionID); err != nil {
				fmt.Fprintf(r.stderr, "warning: start watcher: %v\n", err)
			}
		}
		return nil
	}

	repo, err := r.resolveRepo(bridgeCfg)
	if err != nil {
		return fmt.Errorf("start: resolve repo: %w", err)
	}
	workspaceName := name
	resp, err := r.startWorkspace(workspaceName, repo, bridgeCfg, prompt)
	if err != nil {
		return fmt.Errorf("start: create workspace: %w", err)
	}
	ws, err := r.getWorkspace(resp.Workspace.ID, bridgeCfg.BaseURL)
	if err != nil {
		return fmt.Errorf("start: refresh workspace: %w", err)
	}
	workspacePath := derefString(ws.ContainerRef)
	if workspacePath == "" {
		return fmt.Errorf("start: workspace %s has empty container_ref", ws.ID)
	}
	if err := r.ensureSymlink(cfg.WorkDir, workspacePath); err != nil {
		return fmt.Errorf("start: create workdir symlink: %w", err)
	}
	state = &sessionState{
		SessionName:       name,
		Active:            true,
		GCWorkDir:         cfg.WorkDir,
		VibeBaseURL:       bridgeCfg.BaseURL,
		VibeRepoMatch:     bridgeCfg.RepoMatch,
		VibeRepoID:        repo.ID,
		VibeRepoName:      repo.Name,
		VibeRepoPath:      repo.Path,
		VibeTargetBranch:  repoTargetBranch(repo, bridgeCfg),
		VibeWorkspaceID:   ws.ID,
		VibeWorkspacePath: workspacePath,
		VibeSessionID:     resp.ExecutionProcess.SessionID,
		VibeWorkingDir:    strings.TrimSpace(bridgeCfg.WorkingDir),
		VibeSessionLabel:  strings.TrimSpace(bridgeCfg.SessionLabel),
		Meta:              map[string]string{},
		ExecutorConfig:    bridgeCfg.ExecutorConfig,
	}
	if state.VibeSessionLabel != "" {
		if err := r.updateSessionName(state.VibeBaseURL, state.VibeSessionID, state.VibeSessionLabel); err != nil {
			fmt.Fprintf(r.stderr, "warning: update session name: %v\n", err)
		}
	}
	updateExecutionState(state, resp.ExecutionProcess, r.now())
	if err := r.saveState(state); err != nil {
		return fmt.Errorf("start: save state: %w", err)
	}
	if state.LatestExecutionID != "" {
		if err := r.maybeSpawnWatcher(name, state, state.LatestExecutionID); err != nil {
			fmt.Fprintf(r.stderr, "warning: start watcher: %v\n", err)
		}
	}
	return nil
}

func (r *runner) handleStop(name string) error {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	state, err := r.loadState(name)
	if err != nil || state == nil {
		return nil
	}
	deleteWorkspace := r.boolFromEnv("VIBE_DELETE_WORKSPACE_ON_STOP", defaultDeleteOnStop)
	if state.LatestExecutionID != "" && strings.EqualFold(state.LatestExecutionStatus, watcherStatusRunning) {
		_ = r.stopExecution(state.VibeBaseURL, state.LatestExecutionID)
	}
	state.Active = false
	state.LastActivityAt = r.now().Format(time.RFC3339)
	state.LatestExecutionStatus = strings.TrimSpace(state.LatestExecutionStatus)
	if deleteWorkspace && state.VibeWorkspaceID != "" {
		_ = r.deleteWorkspace(state.VibeBaseURL, state.VibeWorkspaceID)
		_ = removeIfSymlink(state.GCWorkDir)
		return r.deleteState(name)
	}
	return r.saveState(state)
}

func (r *runner) handleInterrupt(name string) error {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	state, err := r.loadState(name)
	if err != nil || state == nil || state.LatestExecutionID == "" {
		return nil
	}
	if err := r.stopExecution(state.VibeBaseURL, state.LatestExecutionID); err != nil {
		fmt.Fprintf(r.stderr, "warning: interrupt stop execution: %v\n", err)
	}
	state.LatestExecutionStatus = "killed"
	state.LastActivityAt = r.now().Format(time.RFC3339)
	return r.saveState(state)
}

func (r *runner) handleIsRunning(name string) error {
	state, err := r.loadState(name)
	if err != nil || state == nil || !state.Active {
		_, _ = io.WriteString(r.stdout, "false\n")
		return nil
	}
	_, _ = io.WriteString(r.stdout, "true\n")
	return nil
}

func (r *runner) handleProcessAlive(name string) error {
	if strings.TrimSpace(name) == "" {
		_, _ = io.WriteString(r.stdout, "false\n")
		return nil
	}
	state, err := r.loadState(name)
	if err != nil || state == nil || !state.Active {
		_, _ = io.WriteString(r.stdout, "false\n")
		return nil
	}
	_, _ = io.WriteString(r.stdout, "true\n")
	return nil
}

func (r *runner) handleNudge(name, prompt string) error {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(prompt) == "" {
		return nil
	}
	state, err := r.loadState(name)
	if err != nil || state == nil || state.VibeSessionID == "" {
		return nil
	}
	execProc, err := r.followUp(state, prompt)
	if err != nil {
		return fmt.Errorf("nudge: follow-up: %w", err)
	}
	state.Active = true
	updateExecutionState(state, execProc, r.now())
	if err := r.saveState(state); err != nil {
		return fmt.Errorf("nudge: save state: %w", err)
	}
	if err := r.maybeSpawnWatcher(name, state, state.LatestExecutionID); err != nil {
		fmt.Fprintf(r.stderr, "warning: nudge watcher: %v\n", err)
	}
	return nil
}

func (r *runner) handleSetMeta(name, key, value string) error {
	state, err := r.loadState(name)
	if err != nil {
		return err
	}
	if state == nil {
		state = &sessionState{SessionName: name, Meta: map[string]string{}}
	}
	if state.Meta == nil {
		state.Meta = map[string]string{}
	}
	state.Meta[key] = value
	return r.saveState(state)
}

func (r *runner) handleGetMeta(name, key string) error {
	state, err := r.loadState(name)
	if err != nil || state == nil || state.Meta == nil {
		return nil
	}
	_, _ = io.WriteString(r.stdout, state.Meta[key])
	return nil
}

func (r *runner) handleRemoveMeta(name, key string) error {
	state, err := r.loadState(name)
	if err != nil || state == nil || state.Meta == nil {
		return nil
	}
	delete(state.Meta, key)
	return r.saveState(state)
}

func (r *runner) handlePeek(name string, lines int) error {
	state, err := r.loadState(name)
	if err != nil || state == nil {
		return nil
	}
	if state.LatestExecutionID != "" {
		if err := r.hydratePeekCache(name, state); err != nil {
			fmt.Fprintf(r.stderr, "warning: hydrate peek: %v\n", err)
		}
	}
	data, err := os.ReadFile(r.peekPath(name))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	content := strings.TrimRight(string(data), "\n")
	if lines > 0 {
		content = tailLines(content, lines)
	}
	if content != "" {
		_, _ = io.WriteString(r.stdout, content)
		if !strings.HasSuffix(content, "\n") {
			_, _ = io.WriteString(r.stdout, "\n")
		}
	}
	return nil
}

func (r *runner) handleListRunning(prefix string) error {
	states, err := r.listStates()
	if err != nil {
		return err
	}
	var names []string
	for _, state := range states {
		if !state.Active {
			continue
		}
		if prefix == "" || strings.HasPrefix(state.SessionName, prefix) {
			names = append(names, state.SessionName)
		}
	}
	sort.Strings(names)
	if len(names) > 0 {
		_, _ = io.WriteString(r.stdout, strings.Join(names, "\n"))
		_, _ = io.WriteString(r.stdout, "\n")
	}
	return nil
}

func (r *runner) handleGetLastActivity(name string) error {
	state, err := r.loadState(name)
	if err != nil || state == nil || strings.TrimSpace(state.LastActivityAt) == "" {
		return nil
	}
	_, _ = io.WriteString(r.stdout, state.LastActivityAt)
	return nil
}

func (r *runner) handleClearScrollback(name string) error {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	path := r.peekPath(name)
	if err := writeFileAtomic(path, nil, 0o644); err != nil {
		return err
	}
	return nil
}

func (r *runner) handleWatchExecution(name, executionID string) error {
	state, err := r.loadState(name)
	if err != nil || state == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), watchConnectTimeout)
	defer cancel()
	if err := r.streamExecution(ctx, name, state, executionID, false); err != nil {
		return fmt.Errorf("watch-execution: %w", err)
	}
	return nil
}

func (r *runner) hydratePeekCache(name string, state *sessionState) error {
	ctx, cancel := context.WithTimeout(context.Background(), peekHydrationTimeout)
	defer cancel()
	return r.streamExecution(ctx, name, state, state.LatestExecutionID, true)
}

func (r *runner) streamExecution(ctx context.Context, name string, state *sessionState, executionID string, stopEarly bool) error {
	baseURL := strings.TrimRight(state.VibeBaseURL, "/")
	wsURL, err := websocketURL(baseURL + "/api/execution-processes/" + executionID + "/normalized-logs/ws")
	if err != nil {
		return err
	}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	cachePath := r.peekPath(name)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(watchReadTimeout))
		_, data, err := conn.ReadMessage()
		if err != nil {
			if stopEarly && websocket.IsUnexpectedCloseError(err) {
				return nil
			}
			var netErr interface{ Timeout() bool }
			if errors.As(err, &netErr) && netErr.Timeout() {
				if stopEarly {
					return nil
				}
				select {
				case <-ctx.Done():
					return nil
				default:
					continue
				}
			}
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) || errors.Is(err, io.EOF) {
				break
			}
			if stopEarly {
				return nil
			}
			return err
		}
		finished, text, err := extractPatchText(data)
		if err != nil {
			if stopEarly {
				return nil
			}
			fmt.Fprintf(r.stderr, "warning: decode log patch: %v\n", err)
			continue
		}
		if text != "" {
			if err := appendLine(cachePath, text); err != nil {
				return err
			}
			state.LastActivityAt = r.now().Format(time.RFC3339)
			state.LatestExecutionStatus = watcherStatusRunning
			state.LastWatchedExecutionID = executionID
			_ = r.saveState(state)
		}
		if finished {
			break
		}
		if stopEarly {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		default:
		}
	}
	proc, err := r.getExecutionProcess(state.VibeBaseURL, executionID)
	if err == nil {
		updateExecutionState(state, proc, r.now())
		state.LastWatchedExecutionID = executionID
		_ = r.saveState(state)
	}
	return nil
}

func (r *runner) maybeSpawnWatcher(name string, state *sessionState, executionID string) error {
	if executionID == "" || state.LastWatchedExecutionID == executionID {
		return nil
	}
	state.LastWatchedExecutionID = executionID
	if err := r.saveState(state); err != nil {
		return err
	}
	return r.spawnWatcher(name, executionID)
}

func (r *runner) loadBridgeConfig(startEnv map[string]string) (bridgeConfig, error) {
	get := func(key string) string {
		if v := strings.TrimSpace(startEnv[key]); v != "" {
			return v
		}
		return strings.TrimSpace(r.env[key])
	}
	cfg := bridgeConfig{
		BaseURL:               defaultString(get("VIBE_BASE_URL"), defaultBaseURL),
		RepoMatch:             get("VIBE_REPO_MATCH"),
		TargetBranch:          get("VIBE_TARGET_BRANCH"),
		DeleteWorkspaceOnStop: parseBool(defaultString(get("VIBE_DELETE_WORKSPACE_ON_STOP"), strconv.FormatBool(defaultDeleteOnStop))),
		StateRoot:             defaultString(get("VIBE_STATE_ROOT"), defaultString(r.env["GC_EXEC_STATE_DIR"], filepath.Join(os.TempDir(), defaultStateDirName))),
		AdoptWorkspaceID:      get("VIBE_ADOPT_WORKSPACE_ID"),
		AdoptSessionID:        get("VIBE_ADOPT_SESSION_ID"),
		SessionLabel:          get("VIBE_SESSION_LABEL"),
		WorkingDir:            get("VIBE_WORKING_DIR"),
		ExecutorConfig: executorConfig{
			Executor:         get("VIBE_EXECUTOR"),
			Variant:          optionalString(get("VIBE_EXECUTOR_VARIANT")),
			ModelID:          optionalString(get("VIBE_MODEL_ID")),
			AgentID:          optionalString(get("VIBE_AGENT_ID")),
			ReasoningID:      optionalString(get("VIBE_REASONING_ID")),
			PermissionPolicy: optionalString(get("VIBE_PERMISSION_POLICY")),
		},
	}
	if cfg.RepoMatch == "" && cfg.AdoptWorkspaceID == "" {
		return bridgeConfig{}, fmt.Errorf("missing VIBE_REPO_MATCH")
	}
	if cfg.ExecutorConfig.Executor == "" {
		return bridgeConfig{}, fmt.Errorf("missing VIBE_EXECUTOR")
	}
	if cfg.TargetBranch == "" {
		cfg.TargetBranch = "main"
	}
	return cfg, nil
}

func (r *runner) loadState(name string) (*sessionState, error) {
	path := r.statePath(name)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var state sessionState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state.Meta == nil {
		state.Meta = map[string]string{}
	}
	return &state, nil
}

func (r *runner) saveState(state *sessionState) error {
	if state == nil {
		return nil
	}
	root := filepath.Dir(r.statePath(state.SessionName))
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return writeFileAtomic(r.statePath(state.SessionName), data, 0o644)
}

func (r *runner) deleteState(name string) error {
	_ = os.Remove(r.statePath(name))
	_ = os.Remove(r.peekPath(name))
	return nil
}

func (r *runner) listStates() ([]*sessionState, error) {
	root := filepath.Dir(r.statePath("placeholder"))
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	states := make([]*sessionState, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(root, entry.Name()))
		if err != nil {
			continue
		}
		var state sessionState
		if err := json.Unmarshal(data, &state); err != nil {
			continue
		}
		states = append(states, &state)
	}
	return states, nil
}

func (r *runner) statePath(name string) string {
	root := defaultString(strings.TrimSpace(r.env["VIBE_STATE_ROOT"]), defaultString(strings.TrimSpace(r.env["GC_EXEC_STATE_DIR"]), filepath.Join(os.TempDir(), defaultStateDirName)))
	return filepath.Join(root, hashName(name)+".json")
}

func (r *runner) peekPath(name string) string {
	root := defaultString(strings.TrimSpace(r.env["VIBE_STATE_ROOT"]), defaultString(strings.TrimSpace(r.env["GC_EXEC_STATE_DIR"]), filepath.Join(os.TempDir(), defaultStateDirName)))
	return filepath.Join(root, hashName(name)+".peek.txt")
}

func (r *runner) resolveRepo(cfg bridgeConfig) (repo, error) {
	var repos []repo
	if err := r.getJSON(cfg.BaseURL+"/api/repos", &repos); err != nil {
		return repo{}, err
	}
	match := strings.TrimSpace(cfg.RepoMatch)
	for _, candidate := range repos {
		if repoMatches(candidate, match) {
			return candidate, nil
		}
	}
	return repo{}, fmt.Errorf("no repo matched %q", match)
}

func (r *runner) startWorkspace(name string, repo repo, cfg bridgeConfig, prompt string) (startWorkspaceResponse, error) {
	payload := startWorkspaceRequest{
		Name:           optionalString(name),
		Repos:          []repoInput{{RepoID: repo.ID, TargetBranch: repoTargetBranch(repo, cfg)}},
		LinkedIssue:    nil,
		ExecutorConfig: cfg.ExecutorConfig,
		Prompt:         prompt,
		AttachmentIDs:  nil,
	}
	var out startWorkspaceResponse
	if err := r.postJSON(cfg.BaseURL+"/api/workspaces/start", payload, &out); err != nil {
		return startWorkspaceResponse{}, err
	}
	return out, nil
}

func (r *runner) getWorkspace(id, baseURL string) (workspace, error) {
	var ws workspace
	if err := r.getJSON(strings.TrimRight(baseURL, "/")+"/api/workspaces/"+id, &ws); err != nil {
		return workspace{}, err
	}
	return ws, nil
}

func (r *runner) getExecutionProcess(baseURL, id string) (executionProcess, error) {
	var proc executionProcess
	if err := r.getJSON(strings.TrimRight(baseURL, "/")+"/api/execution-processes/"+id, &proc); err != nil {
		return executionProcess{}, err
	}
	return proc, nil
}

func (r *runner) followUp(state *sessionState, prompt string) (executionProcess, error) {
	payload := followUpRequest{
		Prompt:          prompt,
		ExecutorConfig:  state.ExecutorConfig,
		WorkingDir:      optionalString(strings.TrimSpace(state.VibeWorkingDir)),
		RetryProcessID:  nil,
		ForceWhenDirty:  nil,
		PerformGitReset: nil,
	}
	var proc executionProcess
	if err := r.postJSON(strings.TrimRight(state.VibeBaseURL, "/")+"/api/sessions/"+state.VibeSessionID+"/follow-up", payload, &proc); err != nil {
		return executionProcess{}, err
	}
	return proc, nil
}

func (r *runner) updateSessionName(baseURL, sessionID, name string) error {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	return r.putJSON(
		strings.TrimRight(baseURL, "/")+"/api/sessions/"+sessionID,
		updateSessionRequest{Name: strings.TrimSpace(name)},
		nil,
	)
}

func (r *runner) stopExecution(baseURL, executionID string) error {
	return r.postJSON(strings.TrimRight(baseURL, "/")+"/api/execution-processes/"+executionID+"/stop", struct{}{}, nil)
}

func (r *runner) deleteWorkspace(baseURL, workspaceID string) error {
	req, err := http.NewRequest(http.MethodDelete, strings.TrimRight(baseURL, "/")+"/api/workspaces/"+workspaceID, nil)
	if err != nil {
		return err
	}
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("delete workspace: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (r *runner) getJSON(rawURL string, out any) error {
	resp, err := r.httpClient.Get(rawURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("GET %s: status %d: %s", rawURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return decodeAPIResponse(resp.Body, out)
}

func (r *runner) postJSON(rawURL string, payload any, out any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := r.httpClient.Post(rawURL, "application/json", bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("POST %s: status %d: %s", rawURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return decodeAPIResponse(resp.Body, out)
}

func (r *runner) putJSON(rawURL string, payload any, out any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, rawURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("PUT %s: status %d: %s", rawURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return decodeAPIResponse(resp.Body, out)
}

func decodeAPIResponse(body io.Reader, out any) error {
	var envelope apiResponse[json.RawMessage]
	if err := json.NewDecoder(body).Decode(&envelope); err != nil {
		return err
	}
	if envelope.Data == nil {
		msg := "missing data"
		if envelope.Message != nil && *envelope.Message != "" {
			msg = *envelope.Message
		}
		return errors.New(msg)
	}
	return json.Unmarshal(*envelope.Data, out)
}

func decodeStartConfig(r io.Reader) (startConfig, error) {
	var cfg startConfig
	data, err := io.ReadAll(r)
	if err != nil {
		return startConfig{}, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return startConfig{}, err
	}
	return cfg, nil
}

func updateExecutionState(state *sessionState, proc executionProcess, now time.Time) {
	state.LatestExecutionID = proc.ID
	state.LatestExecutionStatus = proc.Status
	state.LastActivityAt = now.Format(time.RFC3339)
	if ts := lastNonEmpty(proc.UpdatedAt, proc.CreatedAt, proc.StartedAt); ts != "" {
		state.LastActivityAt = ts
	}
}

func repoTargetBranch(repo repo, cfg bridgeConfig) string {
	if strings.TrimSpace(cfg.TargetBranch) != "" {
		return strings.TrimSpace(cfg.TargetBranch)
	}
	if strings.TrimSpace(repo.DefaultTargetBranch) != "" {
		return strings.TrimSpace(repo.DefaultTargetBranch)
	}
	return "main"
}

func repoMatches(repo repo, match string) bool {
	match = strings.TrimSpace(match)
	if match == "" {
		return false
	}
	if repo.ID == match || repo.Path == match || repo.Name == match || repo.DisplayName == match {
		return true
	}
	if filepath.Base(repo.Path) == match {
		return true
	}
	return false
}

func websocketURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	return u.String(), nil
}

func extractPatchText(data []byte) (finished bool, text string, err error) {
	trimmed := bytes.TrimSpace(data)
	if bytes.Equal(trimmed, []byte(`{"finished":true}`)) {
		return true, "", nil
	}
	if bytes.Equal(trimmed, []byte(`{"Ready":true}`)) {
		return false, "", nil
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return false, "", err
	}
	if _, ok := envelope["finished"]; ok {
		return true, "", nil
	}
	patchRaw, ok := envelope["JsonPatch"]
	if !ok {
		patchRaw = envelope["json_patch"]
	}
	if len(patchRaw) == 0 {
		return false, "", nil
	}
	var ops []patchOp
	if err := json.Unmarshal(patchRaw, &ops); err != nil {
		return false, "", err
	}
	var parts []string
	for _, op := range ops {
		switch strings.ToUpper(op.Value.Type) {
		case "STDOUT", "STDERR":
			var chunk string
			if err := json.Unmarshal(op.Value.Content, &chunk); err == nil && strings.TrimSpace(chunk) != "" {
				parts = append(parts, strings.TrimSpace(chunk))
			}
		case "NORMALIZED_ENTRY":
			var entry normalizedEntry
			if err := json.Unmarshal(op.Value.Content, &entry); err == nil && strings.TrimSpace(entry.Content) != "" {
				parts = append(parts, strings.TrimSpace(entry.Content))
			}
		}
	}
	return false, strings.Join(parts, "\n"), nil
}

func appendLine(path, text string) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if _, err := w.WriteString(line + "\n"); err != nil {
			return err
		}
	}
	return w.Flush()
}

func removeIfSymlink(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return nil
	}
	return os.Remove(path)
}

func (r *runner) ensureSymlink(linkPath, target string) error {
	if strings.TrimSpace(linkPath) == "" || strings.TrimSpace(target) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(linkPath), 0o755); err != nil {
		return err
	}
	info, err := os.Lstat(linkPath)
	if err == nil {
		if info.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("workdir path %q already exists and is not a symlink", linkPath)
		}
		currentTarget, err := os.Readlink(linkPath)
		if err == nil && currentTarget == target {
			return nil
		}
		if err := os.Remove(linkPath); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Symlink(target, linkPath)
}

func tailLines(content string, lines int) string {
	if lines <= 0 || content == "" {
		return content
	}
	parts := strings.Split(content, "\n")
	if len(parts) <= lines {
		return content
	}
	return strings.Join(parts[len(parts)-lines:], "\n")
}

func defaultString(v, fallback string) string {
	if strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func optionalString(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func parseBool(v string) bool {
	parsed, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return false
	}
	return parsed
}

func environmentMap(env []string) map[string]string {
	out := make(map[string]string, len(env))
	for _, entry := range env {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) == 2 {
			out[parts[0]] = parts[1]
		}
	}
	return out
}

func hashName(name string) string {
	sum := sha256.Sum256([]byte(name))
	return hex.EncodeToString(sum[:8])
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func lastNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func (r *runner) boolFromEnv(key string, fallback bool) bool {
	if value, ok := r.env[key]; ok && strings.TrimSpace(value) != "" {
		return parseBool(value)
	}
	return fallback
}

func spawnWatcherProcess(sessionName, executionID string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	devNull, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer devNull.Close()
	p, err := os.StartProcess(exe, []string{exe, "watch-execution", sessionName, executionID}, &os.ProcAttr{
		Files: []*os.File{devNull, devNull, devNull},
		Env:   os.Environ(),
	})
	if err != nil {
		return err
	}
	return p.Release()
}
