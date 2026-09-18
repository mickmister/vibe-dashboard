package vibekanbanplugins

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

const defaultPreviewResolverTimeout = 2 * time.Second
const defaultTrustedRequestedHostHeader = "X-Vibe-Requested-Host"
const previewHostnameGrammar = "slot-repo-workspace-customer-v1"
const previewRoutingCapability = "domain-independent-v1"

var encodedPreviewLabelPattern = regexp.MustCompile(`^([a-z0-9]{1,10})-([a-z0-9]{1,18})-([a-f0-9]{16})-([a-z0-9]{1,16})$`)

// PreviewResolver routes encoded preview hostnames through a local resolver API.
type PreviewResolver struct {
	ResolverURL                string         `json:"resolver_url,omitempty"`
	StartupPage                string         `json:"startup_page,omitempty"`
	TrustedRequestedHostHeader string         `json:"trusted_requested_host_header,omitempty"`
	Grammar                    string         `json:"grammar,omitempty"`
	Routing                    string         `json:"routing,omitempty"`
	Timeout                    caddy.Duration `json:"timeout,omitempty"`

	logger *zap.Logger
	client *http.Client
}

type previewHostMatch struct {
	Host           string
	WorkspaceToken string
	RepoSlug       string
	SlotSlug       string
	CustomerSlug   string
}

type previewResolveRequest struct {
	Host           string `json:"host"`
	WorkspaceToken string `json:"workspaceToken"`
	RepoSlug       string `json:"repoSlug"`
	SlotSlug       string `json:"slotSlug"`
	CustomerSlug   string `json:"customerSlug"`
	Ensure         bool   `json:"ensure"`
	Method         string `json:"method"`
	Path           string `json:"path"`
}

type previewResolveResponse struct {
	Status             string `json:"status"`
	Upstream           string `json:"upstream,omitempty"`
	Message            string `json:"message,omitempty"`
	ExecutionProcessID string `json:"executionProcessId,omitempty"`
	WorkspaceID        string `json:"workspaceId,omitempty"`
	PreviewSlotID      string `json:"previewSlotId,omitempty"`
}

// CaddyModule returns the Caddy module information.
func (PreviewResolver) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.vibe_preview_resolver",
		New: func() caddy.Module { return new(PreviewResolver) },
	}
}

// Provision implements caddy.Provisioner.
func (p *PreviewResolver) Provision(ctx caddy.Context) error {
	p.logger = ctx.Logger(p)
	if p.ResolverURL == "" {
		return fmt.Errorf("resolver_url is required")
	}
	if p.Grammar != previewHostnameGrammar {
		return fmt.Errorf("grammar must be %q", previewHostnameGrammar)
	}
	if p.Routing == "" {
		// Migration compatibility for already-deployed Caddy JSON/Caddyfiles.
		p.Routing = previewRoutingCapability
	}
	if p.Routing != previewRoutingCapability {
		return fmt.Errorf("routing must be %q", previewRoutingCapability)
	}
	parsed, err := url.Parse(p.ResolverURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("resolver_url must be an absolute URL")
	}
	p.TrustedRequestedHostHeader = firstNonEmpty(
		strings.TrimSpace(p.TrustedRequestedHostHeader),
		strings.TrimSpace(os.Getenv("PREVIEW_REQUESTED_HOST_HEADER")),
		defaultTrustedRequestedHostHeader,
	)
	timeout := time.Duration(p.Timeout)
	if timeout <= 0 {
		timeout = defaultPreviewResolverTimeout
	}
	p.client = &http.Client{Timeout: timeout}
	return nil
}

// ServeHTTP implements caddyhttp.MiddlewareHandler.
func (p *PreviewResolver) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	requestedHost := p.previewRequestedHost(r)
	match, ok := parseEncodedPreviewHost(requestedHost)
	if !ok {
		return next.ServeHTTP(w, r)
	}

	decision, err := p.resolvePreview(r.Context(), r, match)
	if err != nil {
		if p.logger != nil {
			p.logger.Warn("preview resolver call failed", zap.String("host", match.Host), zap.Error(err))
		}
		p.writePreviewUnavailable(w, r, http.StatusBadGateway, "Preview resolver is unavailable")
		return nil
	}

	switch decision.Status {
	case "ready":
		if decision.Upstream == "" {
			p.writePreviewUnavailable(w, r, http.StatusBadGateway, "Preview resolver returned no upstream")
			return nil
		}
		return p.proxyPreview(w, r, match, decision.Upstream)
	case "starting":
		p.writePreviewStarting(w, r, decision)
	case "not_found":
		p.writePreviewUnavailable(w, r, http.StatusNotFound, firstNonEmpty(decision.Message, "Preview target was not found"))
	case "capacity_full":
		p.writePreviewUnavailable(w, r, http.StatusServiceUnavailable, firstNonEmpty(decision.Message, "Preview capacity is full"))
	case "failed", "unavailable", "error":
		p.writePreviewUnavailableWithDecision(w, r, http.StatusBadGateway, firstNonEmpty(decision.Message, "Preview target is unavailable"), decision)
	default:
		p.writePreviewUnavailable(w, r, http.StatusBadGateway, "Preview resolver returned an unknown status")
	}
	return nil
}

func parsePreviewResolverCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	p := new(PreviewResolver)
	for h.Next() {
		if len(h.RemainingArgs()) > 0 {
			return nil, h.ArgErr()
		}
		for h.NextBlock(0) {
			switch h.Val() {
			case "resolver_url":
				if !h.Args(&p.ResolverURL) {
					return nil, h.ArgErr()
				}
			case "startup_page":
				if !h.Args(&p.StartupPage) {
					return nil, h.ArgErr()
				}
			case "base_domain":
				// Deprecated migration compatibility; intentionally ignored.
				var ignored string
				if !h.Args(&ignored) {
					return nil, h.ArgErr()
				}
			case "trusted_requested_host_header":
				if !h.Args(&p.TrustedRequestedHostHeader) {
					return nil, h.ArgErr()
				}
			case "grammar":
				if !h.Args(&p.Grammar) {
					return nil, h.ArgErr()
				}
				if p.Grammar != previewHostnameGrammar {
					return nil, h.Errf("grammar must be %q", previewHostnameGrammar)
				}
			case "routing":
				if !h.Args(&p.Routing) {
					return nil, h.ArgErr()
				}
				if p.Routing != previewRoutingCapability {
					return nil, h.Errf("routing must be %q", previewRoutingCapability)
				}
			case "timeout":
				var raw string
				if !h.Args(&raw) {
					return nil, h.ArgErr()
				}
				duration, err := time.ParseDuration(raw)
				if err != nil {
					return nil, h.Errf("invalid timeout duration %q: %v", raw, err)
				}
				p.Timeout = caddy.Duration(duration)
			default:
				return nil, h.Errf("unrecognized vk_preview_resolver option %q", h.Val())
			}
		}
	}
	return p, nil
}

func (p *PreviewResolver) previewRequestedHost(r *http.Request) string {
	requestedHostHeader := firstNonEmpty(
		strings.TrimSpace(p.TrustedRequestedHostHeader),
		defaultTrustedRequestedHostHeader,
	)
	if value := firstForwardedHost(r.Header.Get(requestedHostHeader)); value != "" {
		return normalizePreviewHost(value)
	}
	return normalizePreviewHost(r.Host)
}

func firstForwardedHost(value string) string {
	parts := strings.Split(value, ",")
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizePreviewHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimSuffix(host, ".")
	if host == "" {
		return ""
	}
	if strings.Contains(host, ":") {
		if parsedHost, _, err := net.SplitHostPort(host); err == nil {
			return strings.TrimSuffix(parsedHost, ".")
		}
	}
	return host
}

func parseEncodedPreviewHost(host string) (previewHostMatch, bool) {
	host = normalizePreviewHost(host)
	if host == "" {
		return previewHostMatch{}, false
	}
	firstLabel, rest, ok := strings.Cut(host, ".")
	if !ok || rest == "" {
		return previewHostMatch{}, false
	}
	if strings.Count(firstLabel, "-") != 3 {
		return previewHostMatch{}, false
	}
	matches := encodedPreviewLabelPattern.FindStringSubmatch(firstLabel)
	if matches == nil {
		return previewHostMatch{}, false
	}
	return previewHostMatch{
		Host:           host,
		WorkspaceToken: matches[3],
		RepoSlug:       matches[2],
		SlotSlug:       matches[1],
		CustomerSlug:   matches[4],
	}, true
}

func (p *PreviewResolver) resolvePreview(ctx context.Context, r *http.Request, match previewHostMatch) (previewResolveResponse, error) {
	payload := previewResolveRequest{
		Host:           match.Host,
		WorkspaceToken: match.WorkspaceToken,
		RepoSlug:       match.RepoSlug,
		SlotSlug:       match.SlotSlug,
		CustomerSlug:   match.CustomerSlug,
		Ensure:         isPreviewEnsureRequest(r),
		Method:         r.Method,
		Path:           r.URL.RequestURI(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return previewResolveResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.ResolverURL, bytes.NewReader(body))
	if err != nil {
		return previewResolveResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return previewResolveResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return previewResolveResponse{}, fmt.Errorf("resolver returned HTTP %d", resp.StatusCode)
	}
	var decision previewResolveResponse
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 64*1024))
	if err := decoder.Decode(&decision); err != nil {
		return previewResolveResponse{}, err
	}
	decision.Status = strings.ToLower(strings.TrimSpace(decision.Status))
	return decision, nil
}

func isPreviewEnsureRequest(r *http.Request) bool {
	if r.Method != http.MethodGet || isUpgradeRequest(r) {
		return false
	}
	mode := strings.ToLower(r.Header.Get("Sec-Fetch-Mode"))
	dest := strings.ToLower(r.Header.Get("Sec-Fetch-Dest"))
	return mode == "navigate" || dest == "document"
}

func (p *PreviewResolver) proxyPreview(w http.ResponseWriter, r *http.Request, match previewHostMatch, upstream string) error {
	target, err := url.Parse(upstream)
	if err != nil || target.Scheme == "" || target.Host == "" {
		p.writePreviewUnavailable(w, r, http.StatusBadGateway, "Preview resolver returned an invalid upstream")
		return nil
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	baseDirector := proxy.Director
	proxy.Director = func(out *http.Request) {
		baseDirector(out)
		out.Host = target.Host
		scrubPreviewProxyHeaders(out.Header)
		out.Header.Set("X-Vibe-Requested-Host", match.Host)
		out.Header.Set("X-Vibe-Preview-Workspace-Token", match.WorkspaceToken)
		out.Header.Set("X-Vibe-Preview-Repo", match.RepoSlug)
		out.Header.Set("X-Vibe-Preview-Slot", match.SlotSlug)
		out.Header.Set("X-Vibe-Preview-Customer", match.CustomerSlug)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		if p.logger != nil {
			p.logger.Warn("preview upstream proxy failed", zap.String("host", match.Host), zap.Error(err))
		}
		p.writePreviewUnavailable(w, req, http.StatusBadGateway, "Preview upstream is unavailable")
	}
	proxy.ServeHTTP(w, r)
	return nil
}

func scrubPreviewProxyHeaders(header http.Header) {
	header.Del("Forwarded")
	header.Del("X-Forwarded-Host")
	header.Del("X-Vibe-Requested-Host")
	for name := range header {
		if strings.HasPrefix(strings.ToLower(name), "x-vibe-preview-") {
			header.Del(name)
		}
	}
}

func (p *PreviewResolver) writePreviewStarting(w http.ResponseWriter, r *http.Request, decision previewResolveResponse) {
	if isPreviewEnsureRequest(r) {
		logsURL := p.previewLogsURL(r, decision)
		if logsURL == "" && p.StartupPage != "" {
			if content, err := os.ReadFile(p.StartupPage); err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write(content)
				return
			}
		}
		p.writePreviewHTML(w, http.StatusServiceUnavailable, "Preview starting", "Preview server is starting. Refresh shortly.", logsURL)
		return
	}
	p.writePreviewPlain(w, http.StatusServiceUnavailable, "Preview server is starting")
}

func (p *PreviewResolver) writePreviewUnavailable(w http.ResponseWriter, r *http.Request, status int, message string) {
	p.writePreviewUnavailableWithDecision(w, r, status, message, previewResolveResponse{})
}

func (p *PreviewResolver) writePreviewUnavailableWithDecision(w http.ResponseWriter, r *http.Request, status int, message string, decision previewResolveResponse) {
	if isPreviewEnsureRequest(r) {
		p.writePreviewHTML(w, status, http.StatusText(status), message, p.previewLogsURL(r, decision))
		return
	}
	p.writePreviewPlain(w, status, message)
}

func (p *PreviewResolver) writePreviewHTML(w http.ResponseWriter, status int, title string, message string, logsURL string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	action := ""
	if logsURL != "" {
		action = fmt.Sprintf(`<p><a href="%s">Open logs in VD</a></p>`, html.EscapeString(logsURL))
	}
	_, _ = fmt.Fprintf(w, "<!doctype html><html><head><title>%s</title></head><body><h1>%s</h1><p>%s</p>%s</body></html>", html.EscapeString(title), html.EscapeString(title), html.EscapeString(message), action)
}

func (p *PreviewResolver) previewLogsURL(r *http.Request, decision previewResolveResponse) string {
	if decision.WorkspaceID == "" || decision.PreviewSlotID == "" || decision.ExecutionProcessID == "" {
		return ""
	}
	host := r.Host
	requestedHost := p.previewRequestedHost(r)
	_, requestedParent, requestedIsPreview := splitEncodedPreviewHost(requestedHost)
	if requestedIsPreview && requestedParent == "localhost" {
		_, port, err := net.SplitHostPort(r.Host)
		if err != nil || port == "" {
			return ""
		}
		host = net.JoinHostPort("localhost", port)
	} else if _, _, actualIsPreview := splitEncodedPreviewHost(r.Host); actualIsPreview || normalizePreviewHost(r.Host) == normalizePreviewHost(requestedHost) {
		// Without a distinct Worker-preserved host, linking back to the preview
		// hostname would re-enter the resolver instead of opening VD.
		return ""
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	query := url.Values{
		"views":              {"runtime:dev.mickmister.preview-server/run-configs"},
		"previewWorkspaceId": {decision.WorkspaceID},
		"previewSlotId":      {decision.PreviewSlotID},
	}
	return (&url.URL{Scheme: scheme, Host: host, Path: "/", RawQuery: query.Encode()}).String()
}

func splitEncodedPreviewHost(host string) (previewHostMatch, string, bool) {
	normalized := normalizePreviewHost(host)
	_, parent, hasParent := strings.Cut(normalized, ".")
	match, matched := parseEncodedPreviewHost(normalized)
	return match, parent, hasParent && matched
}

func (p *PreviewResolver) writePreviewPlain(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(message))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

var (
	_ caddy.Provisioner           = (*PreviewResolver)(nil)
	_ caddyhttp.MiddlewareHandler = (*PreviewResolver)(nil)
)
