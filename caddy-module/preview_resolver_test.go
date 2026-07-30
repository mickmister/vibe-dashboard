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
	match, ok := parseEncodedPreviewHost("preview-workspace-abc-3--mickmister.vibedashboard.dev", "vibedashboard.dev")
	if !ok {
		t.Fatal("expected encoded preview host to match")
	}
	if match.WorkspaceID != "workspace-abc" || match.Slot != 3 || match.Customer != "mickmister" {
		t.Fatalf("unexpected match: %+v", match)
	}
}

func TestParseEncodedPreviewHostRejectsInvalidHosts(t *testing.T) {
	cases := []string{
		"port-3000--mickmister.vibedashboard.dev",
		"preview-workspace-6--mickmister.vibedashboard.dev",
		"preview-workspace-1--bad--slug.vibedashboard.dev",
		"preview-workspace-1--mickmister.other.dev",
	}
	for _, tc := range cases {
		if _, ok := parseEncodedPreviewHost(tc, "vibedashboard.dev"); ok {
			t.Fatalf("expected %q to be rejected", tc)
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

	handler := &PreviewResolver{ResolverURL: resolver.URL, BaseDomain: "vibedashboard.dev", client: resolver.Client()}

	req := httptest.NewRequest(http.MethodGet, "https://mickmister.vibedashboard.dev/", nil)
	req.Header.Set("X-Vibe-Requested-Host", "preview-workspace-abc-2--mickmister.vibedashboard.dev")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	rec := httptest.NewRecorder()

	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error { t.Fatal("next handler should not run"); return nil })); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if got.Host != "preview-workspace-abc-2--mickmister.vibedashboard.dev" || got.WorkspaceID != "workspace-abc" || got.Slot != 2 || got.Customer != "mickmister" {
		t.Fatalf("unexpected resolver request: %+v", got)
	}
	if !got.Ensure {
		t.Fatalf("expected document navigation to request ensure=true: %+v", got)
	}
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "Preview server is starting") {
		t.Fatalf("unexpected starting response %d %q", rec.Code, rec.Body.String())
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

	req := httptest.NewRequest(http.MethodGet, "https://preview-workspace-abc-1--mickmister.vibedashboard.dev/assets/app.js", nil)
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
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHost = r.Host
		requestedHost = r.Header.Get("X-Vibe-Requested-Host")
		_, _ = w.Write([]byte("preview ok"))
	}))
	defer upstream.Close()

	resolver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready","upstream":` + strconvQuote(upstream.URL) + `}`))
	}))
	defer resolver.Close()

	handler := &PreviewResolver{ResolverURL: resolver.URL, BaseDomain: "vibedashboard.dev", client: resolver.Client()}

	req := httptest.NewRequest(http.MethodGet, "https://preview-workspace-abc-1--mickmister.vibedashboard.dev/ws", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	rec := httptest.NewRecorder()
	if err := handler.ServeHTTP(rec, req, caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error { t.Fatal("next handler should not run"); return nil })); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "preview ok" {
		t.Fatalf("unexpected proxy response %d %q", rec.Code, rec.Body.String())
	}
	if upstreamHost == "" || requestedHost != "preview-workspace-abc-1--mickmister.vibedashboard.dev" {
		t.Fatalf("unexpected upstream host/header: host=%q requested=%q", upstreamHost, requestedHost)
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

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
