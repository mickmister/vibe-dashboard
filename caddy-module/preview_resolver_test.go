package vibekanbanplugins

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func TestParseEncodedPreviewHost(t *testing.T) {
	match, ok := parseEncodedPreviewHost("0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev", "vibedashboard.dev")
	if !ok {
		t.Fatal("expected encoded preview host to match")
	}
	if match.WorkspaceToken != "0123456789abcdef" || match.RepoSlug != "vibekanban" || match.SlotSlug != "web" || match.CustomerSlug != "mickmister" {
		t.Fatalf("unexpected match: %+v", match)
	}
}

func TestParseEncodedPreviewHostAcceptsDnsBoundaryLengths(t *testing.T) {
	repoSlug := strings.Repeat("r", 18)
	slotSlug := strings.Repeat("s", 10)
	customerSlug := strings.Repeat("c", 16)
	host := "0123456789abcdef-" + repoSlug + "-" + slotSlug + "-" + customerSlug + ".vibedashboard.dev"
	firstLabel, _, _ := strings.Cut(host, ".")
	if len(firstLabel) != 63 {
		t.Fatalf("test host first label must be exactly 63 chars, got %d", len(firstLabel))
	}

	match, ok := parseEncodedPreviewHost(host, "vibedashboard.dev")
	if !ok {
		t.Fatal("expected exact DNS-boundary preview host to match")
	}
	if match.RepoSlug != repoSlug || match.SlotSlug != slotSlug || match.CustomerSlug != customerSlug {
		t.Fatalf("unexpected boundary match: %+v", match)
	}
}

func TestParseEncodedPreviewHostRejectsInvalidHosts(t *testing.T) {
	cases := map[string]string{
		"port-style":                "port-3000--mickmister.vibedashboard.dev",
		"old numeric preview":       "preview-workspace-6--mickmister.vibedashboard.dev",
		"old double dash preview":   "preview-workspace-1--bad--slug.vibedashboard.dev",
		"wrong base domain":         "0123456789abcdef-vibekanban-web-mickmister.other.dev",
		"workspace token too short": "0123456789abcde-vibekanban-web-mickmister.vibedashboard.dev",
		"workspace token too long":  "0123456789abcdef0-vibekanban-web-mickmister.vibedashboard.dev",
		"workspace token non-hex":   "0123456789abcdeg-vibekanban-web-mickmister.vibedashboard.dev",
		"repo with dash":            "0123456789abcdef-vibe-kanban-web-mickmister.vibedashboard.dev",
		"repo too long":             "0123456789abcdef-" + strings.Repeat("r", 19) + "-web-mickmister.vibedashboard.dev",
		"slot too long":             "0123456789abcdef-vibekanban-" + strings.Repeat("s", 11) + "-mickmister.vibedashboard.dev",
		"customer too long":         "0123456789abcdef-vibekanban-web-" + strings.Repeat("c", 17) + ".vibedashboard.dev",
		"extra label part":          "0123456789abcdef-vibekanban-web-mickmister-extra.vibedashboard.dev",
	}
	for name, tc := range cases {
		if _, ok := parseEncodedPreviewHost(tc, "vibedashboard.dev"); ok {
			t.Fatalf("expected %s host %q to be rejected", name, tc)
		}
	}
}

func TestPreviewResolverUsesRequestedHostHeaderAndEnsuresOnlyDocumentNavigations(t *testing.T) {
	var got previewResolveRequest
	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode resolver request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"starting"}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{
		ResolverURL:                resolver.URL,
		BaseDomain:                 "vibedashboard.dev",
		TrustedRequestedHostHeader: defaultTrustedRequestedHostHeader,
		client:                     resolver.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "https://mickmister.vibedashboard.dev/", nil)
	req.Header.Set("X-Vibe-Requested-Host", "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	rec := httptest.NewRecorder()

	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error { t.Fatal("next handler should not run"); return nil })); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if got.Host != "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev" || got.WorkspaceToken != "0123456789abcdef" || got.RepoSlug != "vibekanban" || got.SlotSlug != "web" || got.CustomerSlug != "mickmister" {
		t.Fatalf("unexpected resolver request: %+v", got)
	}
	if !got.Ensure {
		t.Fatalf("expected document navigation to request ensure=true: %+v", got)
	}
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "Preview server is starting") {
		t.Fatalf("unexpected starting response %d %q", rec.Code, rec.Body.String())
	}
}

func TestPreviewResolverUsesRequestedHostHeaderWithoutSharedSecret(t *testing.T) {
	var got previewResolveRequest
	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode resolver request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"starting"}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{
		ResolverURL:                resolver.URL,
		BaseDomain:                 "vibedashboard.dev",
		TrustedRequestedHostHeader: defaultTrustedRequestedHostHeader,
		client:                     resolver.Client(),
	}
	req := httptest.NewRequest(http.MethodGet, "https://mickmister.vibedashboard.dev/", nil)
	req.Header.Set("X-Vibe-Requested-Host", "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev")
	rec := httptest.NewRecorder()

	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		t.Fatal("next handler should not run")
		return nil
	})); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if got.Host != "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev" {
		t.Fatalf("expected requested-host header to be used without shared secret, got %+v", got)
	}
}

func TestPreviewResolverRoutesLocalhostSubdomainPreviewHosts(t *testing.T) {
	var got previewResolveRequest
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("local-preview-ok"))
	}))
	defer upstream.Close()

	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode resolver request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready","upstream":` + strconvQuote(upstream.URL) + `}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{ResolverURL: resolver.URL, BaseDomain: "localhost", client: resolver.Client()}
	req := httptest.NewRequest(http.MethodGet, "http://0123456789abcdef-vibekanban-web-preview.localhost:55743/", nil)
	rec := httptest.NewRecorder()

	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		t.Fatal("next handler should not run")
		return nil
	})); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if rec.Code != http.StatusOK || rec.Body.String() != "local-preview-ok" {
		t.Fatalf("unexpected local proxy response %d %q", rec.Code, rec.Body.String())
	}
	if got.Host != "0123456789abcdef-vibekanban-web-preview.localhost" ||
		got.WorkspaceToken != "0123456789abcdef" ||
		got.RepoSlug != "vibekanban" ||
		got.SlotSlug != "web" ||
		got.CustomerSlug != "preview" {
		t.Fatalf("unexpected resolver request: %+v", got)
	}
}

func TestPreviewResolverIgnoresForwardedHostHeader(t *testing.T) {
	handler := &PreviewResolver{ResolverURL: "http://127.0.0.1:1/resolve", BaseDomain: "vibedashboard.dev", client: http.DefaultClient}
	req := httptest.NewRequest(http.MethodGet, "https://mickmister.vibedashboard.dev/", nil)
	req.Header.Set("X-Forwarded-Host", "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev")
	rec := httptest.NewRecorder()

	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		_, _ = w.Write([]byte("next"))
		return nil
	})); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if rec.Body.String() != "next" {
		t.Fatalf("expected X-Forwarded-Host to fall through, got %q", rec.Body.String())
	}
}

func TestPreviewResolverDoesNotEnsureForAssetsOrWebSockets(t *testing.T) {
	var got previewResolveRequest
	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode resolver request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"starting"}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{ResolverURL: resolver.URL, BaseDomain: "vibedashboard.dev", client: resolver.Client()}

	req := httptest.NewRequest(http.MethodGet, "https://0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev/assets/app.js", nil)
	rec := httptest.NewRecorder()
	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error { t.Fatal("next handler should not run"); return nil })); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if got.Ensure {
		t.Fatalf("expected asset request to avoid ensure=true: %+v", got)
	}
	if rec.Code != http.StatusServiceUnavailable || strings.Contains(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("expected plain 503 for asset request, got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestPreviewResolverProxiesReadyUpstreamWithPreviewHeaders(t *testing.T) {
	var upstreamHost string
	var requestedHost string
	var workspaceToken string
	var repoSlug string
	var slotSlug string
	var customerSlug string
	var forwarded string
	var forwardedHost string
	var spoofedPreviewSecret string
	var spoofedPreviewWorkspaceID string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHost = r.Host
		requestedHost = r.Header.Get("X-Vibe-Requested-Host")
		workspaceToken = r.Header.Get("X-Vibe-Preview-Workspace-Token")
		repoSlug = r.Header.Get("X-Vibe-Preview-Repo")
		slotSlug = r.Header.Get("X-Vibe-Preview-Slot")
		customerSlug = r.Header.Get("X-Vibe-Preview-Customer")
		forwarded = r.Header.Get("Forwarded")
		forwardedHost = r.Header.Get("X-Forwarded-Host")
		spoofedPreviewSecret = r.Header.Get("X-Vibe-Preview-Secret")
		spoofedPreviewWorkspaceID = r.Header.Get("X-Vibe-Preview-Workspace-Id")
		_, _ = w.Write([]byte("preview ok"))
	}))
	defer upstream.Close()

	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready","upstream":` + strconvQuote(upstream.URL) + `}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{ResolverURL: resolver.URL, BaseDomain: "vibedashboard.dev", client: resolver.Client()}

	req := httptest.NewRequest(http.MethodGet, "https://0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev/ws", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Forwarded", "host=spoof.example.com")
	req.Header.Set("X-Forwarded-Host", "spoof.example.com")
	req.Header.Set("X-Vibe-Requested-Host", "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev")
	req.Header.Set("X-Vibe-Preview-Secret", "spoof-secret")
	req.Header.Set("X-Vibe-Preview-Workspace-Id", "workspace-spoof")
	rec := httptest.NewRecorder()
	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error { t.Fatal("next handler should not run"); return nil })); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "preview ok" {
		t.Fatalf("unexpected proxy response %d %q", rec.Code, rec.Body.String())
	}
	if upstreamHost == "" || requestedHost != "0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev" {
		t.Fatalf("unexpected upstream host/header: host=%q requested=%q", upstreamHost, requestedHost)
	}
	if workspaceToken != "0123456789abcdef" || repoSlug != "vibekanban" || slotSlug != "web" || customerSlug != "mickmister" {
		t.Fatalf("unexpected preview metadata headers: workspace=%q repo=%q slot=%q customer=%q", workspaceToken, repoSlug, slotSlug, customerSlug)
	}
	if forwarded != "" || forwardedHost != "" || spoofedPreviewSecret != "" || spoofedPreviewWorkspaceID != "" {
		t.Fatalf("expected spoofable proxy/preview headers to be scrubbed, forwarded=%q forwardedHost=%q previewSecret=%q previewWorkspaceId=%q", forwarded, forwardedHost, spoofedPreviewSecret, spoofedPreviewWorkspaceID)
	}
}

func TestPreviewResolverFallsThroughForNonPreviewHosts(t *testing.T) {
	handler := &PreviewResolver{ResolverURL: "http://127.0.0.1:1/resolve", BaseDomain: "vibedashboard.dev", client: http.DefaultClient}
	req := httptest.NewRequest(http.MethodGet, "https://mickmister.vibedashboard.dev/", nil)
	rec := httptest.NewRecorder()
	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		_, _ = w.Write([]byte("next"))
		return nil
	})); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if rec.Body.String() != "next" {
		t.Fatalf("expected non-preview host to fall through, got %q", rec.Body.String())
	}
}

func TestPreviewResolverFallsThroughForPreviewHostsOutsideBaseDomain(t *testing.T) {
	handler := &PreviewResolver{ResolverURL: "http://127.0.0.1:1/resolve", BaseDomain: "vibedashboard.dev", client: http.DefaultClient}
	req := httptest.NewRequest(http.MethodGet, "https://0123456789abcdef-vibekanban-web-mickmister.other.example/", nil)
	rec := httptest.NewRecorder()
	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		_, _ = w.Write([]byte("next"))
		return nil
	})); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if rec.Body.String() != "next" {
		t.Fatalf("expected preview host outside base domain to fall through, got %q", rec.Body.String())
	}
}

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
