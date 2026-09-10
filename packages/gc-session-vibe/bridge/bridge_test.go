package vibeexec

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHandleStartCreatesStateAndSymlink(t *testing.T) {
	t.Parallel()

	workspaceTarget := t.TempDir()
	var startPayload startWorkspaceRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/repos":
			writeAPIResponse(t, w, []repo{{
				ID:          "repo-1",
				Path:        "/repos/gascity",
				Name:        "gascity",
				DisplayName: "Gas City",
			}})
		case r.Method == http.MethodPost && r.URL.Path == "/api/workspaces/start":
			mustDecodeJSON(t, r.Body, &startPayload)
			writeAPIResponse(t, w, startWorkspaceResponse{
				Workspace: workspace{ID: "ws-1"},
				ExecutionProcess: executionProcess{
					ID:        "exec-1",
					SessionID: "session-1",
					Status:    watcherStatusRunning,
					CreatedAt: "2026-04-28T00:00:00Z",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/workspaces/ws-1":
			writeAPIResponse(t, w, workspace{ID: "ws-1", ContainerRef: stringPtr(workspaceTarget)})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	linkPath := filepath.Join(t.TempDir(), "workdir")
	watchCalls := 0
	r := testRunner(stateRoot, server.URL)
	r.spawnWatcher = func(sessionName, executionID string) error {
		watchCalls++
		if sessionName != "agent-1" || executionID != "exec-1" {
			t.Fatalf("spawnWatcher(%q, %q)", sessionName, executionID)
		}
		return nil
	}

	if err := r.handleStart("agent-1", startConfig{WorkDir: linkPath, Nudge: "ship it"}); err != nil {
		t.Fatalf("handleStart: %v", err)
	}
	if got := startPayload.Prompt; got != "ship it" {
		t.Fatalf("prompt = %q, want %q", got, "ship it")
	}
	if got := startPayload.ExecutorConfig.Executor; got != "CODEX" {
		t.Fatalf("executor = %q, want CODEX", got)
	}
	if got := startPayload.Repos[0].TargetBranch; got != "feature/vibe" {
		t.Fatalf("target branch = %q, want feature/vibe", got)
	}
	if watchCalls != 1 {
		t.Fatalf("spawnWatcher calls = %d, want 1", watchCalls)
	}

	state, err := r.loadState("agent-1")
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if state == nil || !state.Active {
		t.Fatalf("state active = %v, want true", state)
	}
	if state.VibeWorkspacePath != workspaceTarget {
		t.Fatalf("workspace path = %q, want %q", state.VibeWorkspacePath, workspaceTarget)
	}
	if state.LatestExecutionID != "exec-1" {
		t.Fatalf("latest execution = %q, want exec-1", state.LatestExecutionID)
	}
	if target, err := os.Readlink(linkPath); err != nil || target != workspaceTarget {
		t.Fatalf("Readlink(%q) = %q, %v; want %q", linkPath, target, err, workspaceTarget)
	}
}

func TestHandleNudgeUpdatesExecutionAndListRunning(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/sessions/session-1/follow-up":
			var payload followUpRequest
			mustDecodeJSON(t, r.Body, &payload)
			if payload.Prompt != "follow up" {
				t.Fatalf("follow-up prompt = %q", payload.Prompt)
			}
			if payload.WorkingDir == nil || *payload.WorkingDir != "repo-a" {
				t.Fatalf("follow-up working_dir = %#v, want repo-a", payload.WorkingDir)
			}
			writeAPIResponse(t, w, executionProcess{
				ID:        "exec-2",
				SessionID: "session-1",
				Status:    watcherStatusRunning,
				UpdatedAt: "2026-04-28T01:02:03Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	r := testRunner(stateRoot, server.URL)
	r.spawnWatcher = func(sessionName, executionID string) error { return nil }
	state := &sessionState{
		SessionName:       "agent-2",
		Active:            true,
		VibeBaseURL:       server.URL,
		VibeWorkspaceID:   "ws-1",
		VibeSessionID:     "session-1",
		VibeWorkingDir:    "repo-a",
		ExecutorConfig:    executorConfig{Executor: "CODEX"},
		Meta:              map[string]string{},
		LatestExecutionID: "exec-1",
		GCWorkDir:         filepath.Join(t.TempDir(), "link"),
	}
	if err := r.saveState(state); err != nil {
		t.Fatalf("saveState: %v", err)
	}

	if err := r.handleNudge("agent-2", "follow up"); err != nil {
		t.Fatalf("handleNudge: %v", err)
	}
	loaded, err := r.loadState("agent-2")
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if loaded.LatestExecutionID != "exec-2" {
		t.Fatalf("latest execution = %q, want exec-2", loaded.LatestExecutionID)
	}
	if loaded.LastActivityAt != "2026-04-28T01:02:03Z" {
		t.Fatalf("last activity = %q", loaded.LastActivityAt)
	}

	var stdout bytes.Buffer
	r.stdout = &stdout
	if err := r.handleListRunning("agent"); err != nil {
		t.Fatalf("handleListRunning: %v", err)
	}
	if got := strings.TrimSpace(stdout.String()); got != "agent-2" {
		t.Fatalf("list-running = %q, want agent-2", got)
	}
}

func TestHandleInterruptStopsExecutionAndMarksKilled(t *testing.T) {
	t.Parallel()

	stopCalled := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/execution-processes/exec-running/stop":
			stopCalled++
			writeAPIResponse(t, w, struct{}{})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	r := testRunner(t.TempDir(), server.URL)
	if err := r.saveState(&sessionState{
		SessionName:           "agent-interrupt",
		Active:                true,
		VibeBaseURL:           server.URL,
		VibeWorkspaceID:       "ws-1",
		VibeSessionID:         "session-1",
		LatestExecutionID:     "exec-running",
		LatestExecutionStatus: watcherStatusRunning,
		ExecutorConfig:        executorConfig{Executor: "CODEX"},
		Meta:                  map[string]string{},
	}); err != nil {
		t.Fatalf("saveState: %v", err)
	}

	if err := r.handleInterrupt("agent-interrupt"); err != nil {
		t.Fatalf("handleInterrupt: %v", err)
	}
	if stopCalled != 1 {
		t.Fatalf("stopCalled = %d, want 1", stopCalled)
	}
	state, err := r.loadState("agent-interrupt")
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if state.LatestExecutionStatus != "killed" {
		t.Fatalf("latest status = %q, want killed", state.LatestExecutionStatus)
	}
	if state.LastActivityAt != "2026-04-28T01:02:03Z" {
		t.Fatalf("last activity = %q", state.LastActivityAt)
	}
}

func TestHandlePeekHydratesNormalizedLogsAndTailsOutput(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/execution-processes/exec-stream/normalized-logs/ws":
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("upgrade: %v", err)
			}
			defer conn.Close()
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"JsonPatch":[{"path":"/entries/0","value":{"type":"NORMALIZED_ENTRY","content":{"content":"first line"}}},{"path":"/entries/1","value":{"type":"STDOUT","content":"second line"}}]}`)); err != nil {
				t.Fatalf("write websocket message: %v", err)
			}
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	r := testRunner(t.TempDir(), server.URL)
	if err := r.saveState(&sessionState{
		SessionName:           "agent-peek",
		Active:                true,
		VibeBaseURL:           server.URL,
		VibeWorkspaceID:       "ws-1",
		VibeSessionID:         "session-1",
		LatestExecutionID:     "exec-stream",
		LatestExecutionStatus: watcherStatusRunning,
		ExecutorConfig:        executorConfig{Executor: "CODEX"},
		Meta:                  map[string]string{},
	}); err != nil {
		t.Fatalf("saveState: %v", err)
	}

	var stdout bytes.Buffer
	r.stdout = &stdout
	if err := r.handlePeek("agent-peek", 1); err != nil {
		t.Fatalf("handlePeek: %v", err)
	}
	if got := strings.TrimSpace(stdout.String()); got != "second line" {
		t.Fatalf("peek stdout = %q, want second line", got)
	}
	loaded, err := r.loadState("agent-peek")
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if loaded.LastWatchedExecutionID != "exec-stream" {
		t.Fatalf("last watched execution = %q, want exec-stream", loaded.LastWatchedExecutionID)
	}
	if loaded.LastActivityAt != "2026-04-28T01:02:03Z" {
		t.Fatalf("last activity = %q", loaded.LastActivityAt)
	}
}

func TestHandleStartAdoptsExistingWorkspaceAndRenamesSession(t *testing.T) {
	t.Parallel()

	workspaceTarget := t.TempDir()
	renameCalled := 0
	var renamedTo string
	var followupPayload followUpRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/workspaces/ws-adopt":
			writeAPIResponse(t, w, workspace{ID: "ws-adopt", ContainerRef: stringPtr(workspaceTarget)})
		case r.Method == http.MethodPut && r.URL.Path == "/api/sessions/session-adopt":
			renameCalled++
			var payload updateSessionRequest
			mustDecodeJSON(t, r.Body, &payload)
			renamedTo = payload.Name
			writeAPIResponse(t, w, map[string]any{"id": "session-adopt"})
		case r.Method == http.MethodPost && r.URL.Path == "/api/sessions/session-adopt/follow-up":
			mustDecodeJSON(t, r.Body, &followupPayload)
			writeAPIResponse(t, w, executionProcess{
				ID:        "exec-adopt",
				SessionID: "session-adopt",
				Status:    watcherStatusRunning,
				UpdatedAt: "2026-04-28T05:06:07Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	linkPath := filepath.Join(t.TempDir(), "workdir")
	r := testRunner(stateRoot, server.URL)
	r.env["VIBE_ADOPT_WORKSPACE_ID"] = "ws-adopt"
	r.env["VIBE_ADOPT_SESSION_ID"] = "session-adopt"
	r.env["VIBE_WORKING_DIR"] = "repo-a"
	r.env["VIBE_SESSION_LABEL"] = "Bootstrap • API"

	if err := r.handleStart("agent-bootstrap", startConfig{
		WorkDir: linkPath,
		Nudge:   "Summarize the repo and plan the work.",
	}); err != nil {
		t.Fatalf("handleStart adopt: %v", err)
	}

	if renameCalled != 1 {
		t.Fatalf("rename calls = %d, want 1", renameCalled)
	}
	if renamedTo != "Bootstrap • API" {
		t.Fatalf("renamedTo = %q, want Bootstrap • API", renamedTo)
	}
	if followupPayload.WorkingDir == nil || *followupPayload.WorkingDir != "repo-a" {
		t.Fatalf("follow-up working_dir = %#v, want repo-a", followupPayload.WorkingDir)
	}
	if followupPayload.Prompt != "Summarize the repo and plan the work." {
		t.Fatalf("follow-up prompt = %q", followupPayload.Prompt)
	}

	state, err := r.loadState("agent-bootstrap")
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if state == nil {
		t.Fatal("state = nil")
	}
	if state.VibeWorkspaceID != "ws-adopt" || state.VibeSessionID != "session-adopt" {
		t.Fatalf("adopted state = %+v", state)
	}
	if state.VibeWorkingDir != "repo-a" {
		t.Fatalf("working dir = %q, want repo-a", state.VibeWorkingDir)
	}
	if state.VibeSessionLabel != "Bootstrap • API" {
		t.Fatalf("session label = %q", state.VibeSessionLabel)
	}
	if target, err := os.Readlink(linkPath); err != nil || target != workspaceTarget {
		t.Fatalf("Readlink(%q) = %q, %v; want %q", linkPath, target, err, workspaceTarget)
	}
}

func TestHandleStopDeletesWorkspaceWhenConfigured(t *testing.T) {
	t.Parallel()

	stopCalled := 0
	deleteCalled := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/execution-processes/exec-9/stop":
			stopCalled++
			writeAPIResponse(t, w, struct{}{})
		case r.Method == http.MethodDelete && r.URL.Path == "/api/workspaces/ws-9":
			deleteCalled++
			writeAPIResponse(t, w, struct{}{})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	linkRoot := t.TempDir()
	workspaceTarget := t.TempDir()
	linkPath := filepath.Join(linkRoot, "workdir")
	if err := os.Symlink(workspaceTarget, linkPath); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	r := testRunner(stateRoot, server.URL)
	r.env["VIBE_DELETE_WORKSPACE_ON_STOP"] = "true"
	state := &sessionState{
		SessionName:           "agent-3",
		Active:                true,
		GCWorkDir:             linkPath,
		VibeBaseURL:           server.URL,
		VibeWorkspaceID:       "ws-9",
		LatestExecutionID:     "exec-9",
		LatestExecutionStatus: watcherStatusRunning,
		ExecutorConfig:        executorConfig{Executor: "CODEX"},
	}
	if err := r.saveState(state); err != nil {
		t.Fatalf("saveState: %v", err)
	}

	if err := r.handleStop("agent-3"); err != nil {
		t.Fatalf("handleStop: %v", err)
	}
	if stopCalled != 1 || deleteCalled != 1 {
		t.Fatalf("stopCalled=%d deleteCalled=%d, want 1/1", stopCalled, deleteCalled)
	}
	if _, err := r.loadState("agent-3"); err != nil {
		t.Fatalf("loadState after stop: %v", err)
	} else if _, statErr := os.Lstat(linkPath); !os.IsNotExist(statErr) {
		t.Fatalf("symlink still exists after stop: %v", statErr)
	}
}

func TestExtractPatchText(t *testing.T) {
	t.Parallel()

	finished, text, err := extractPatchText([]byte(`{"JsonPatch":[{"path":"/entries/0","value":{"type":"NORMALIZED_ENTRY","content":{"content":"assistant says hi"}}},{"path":"/entries/1","value":{"type":"STDOUT","content":"stdout line"}}]}`))
	if err != nil {
		t.Fatalf("extractPatchText: %v", err)
	}
	if finished {
		t.Fatal("finished = true, want false")
	}
	if text != "assistant says hi\nstdout line" {
		t.Fatalf("text = %q", text)
	}

	finished, text, err = extractPatchText([]byte(`{"finished":true}`))
	if err != nil {
		t.Fatalf("extractPatchText finished: %v", err)
	}
	if !finished || text != "" {
		t.Fatalf("finished/text = %v/%q, want true/empty", finished, text)
	}
}

func testRunner(stateRoot, baseURL string) *runner {
	return &runner{
		env: map[string]string{
			"GC_EXEC_STATE_DIR":  stateRoot,
			"VIBE_STATE_ROOT":    stateRoot,
			"VIBE_BASE_URL":      baseURL,
			"VIBE_REPO_MATCH":    "gascity",
			"VIBE_TARGET_BRANCH": "feature/vibe",
			"VIBE_EXECUTOR":      "CODEX",
		},
		stdin:        strings.NewReader(""),
		stdout:       io.Discard,
		stderr:       io.Discard,
		now:          func() time.Time { return time.Date(2026, 4, 28, 1, 2, 3, 0, time.UTC) },
		httpClient:   &http.Client{Timeout: 5 * time.Second},
		spawnWatcher: func(string, string) error { return nil },
	}
}

func writeAPIResponse(t *testing.T, w http.ResponseWriter, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data, "error_data": nil, "message": nil}); err != nil {
		t.Fatalf("Encode: %v", err)
	}
}

func mustDecodeJSON(t *testing.T, r io.Reader, out any) {
	t.Helper()
	if err := json.NewDecoder(r).Decode(out); err != nil {
		t.Fatalf("Decode: %v", err)
	}
}

func stringPtr(s string) *string { return &s }
