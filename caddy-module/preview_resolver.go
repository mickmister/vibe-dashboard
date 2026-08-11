package vibekanbanplugins

import (
	"bytes"
	"context"
	"crypto/subtle"
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
const defaultTrustedRequestedHostSecretHeader = "X-Vibe-Preview-Secret"

var encodedPreviewLabelPattern = regexp.MustCompile(`^([a-f0-9]{16})-([a-z0-9]{1,18})-([a-z0-9]{1,10})-([a-z0-9]{1,16})$`)

// PreviewResolver routes encoded preview hostnames through a local resolver API.
type PreviewResolver struct {
	ResolverURL                      string         `json:"resolver_url,omitempty"`
	StartupPage                      string         `json:"startup_page,omitempty"`
	BaseDomain                       string         `json:"base_domain,omitempty"`
	TrustedRequestedHostHeader       string         `json:"trusted_requested_host_header,omitempty"`
	TrustedRequestedHostSecretHeader string         `json:"trusted_requested_host_secret_header,omitempty"`
	TrustedRequestedHostSecret       string         `json:"trusted_requested_host_secret,omitempty"`
	Timeout                          caddy.Duration `json:"timeout,omitempty"`

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
	Status   string `json:"status"`
	Upstream string `json:"upstream,omitempty"`
	Message  string `json:"message,omitempty"`
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
	parsed, err := url.Parse(p.ResolverURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("resolver_url must be an absolute URL")
	}
	p.BaseDomain = normalizePreviewHost(p.BaseDomain)
	p.TrustedRequestedHostHeader = firstNonEmpty(
		strings.TrimSpace(p.TrustedRequestedHostHeader),
		strings.TrimSpace(os.Getenv("PREVIEW_REQUESTED_HOST_HEADER")),
		defaultTrustedRequestedHostHeader,
	)
	p.TrustedRequestedHostSecretHeader = firstNonEmpty(
		strings.TrimSpace(p.TrustedRequestedHostSecretHeader),
		strings.TrimSpace(os.Getenv("PREVIEW_REQUESTED_HOST_SECRET_HEADER")),
		defaultTrustedRequestedHostSecretHeader,
	)
	p.TrustedRequestedHostSecret = strings.TrimSpace(firstNonEmpty(
		p.TrustedRequestedHostSecret,
		os.Getenv("PREVIEW_REQUESTED_HOST_SECRET"),
	))
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
	match, ok := parseEncodedPreviewHost(requestedHost, p.BaseDomain)
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
		p.writePreviewStarting(w, r)
	case "not_found":
		p.writePreviewUnavailable(w, r, http.StatusNotFound, firstNonEmpty(decision.Message, "Preview target was not found"))
	case "capacity_full":
		p.writePreviewUnavailable(w, r, http.StatusServiceUnavailable, firstNonEmpty(decision.Message, "Preview capacity is full"))
	case "failed", "unavailable", "error":
		p.writePreviewUnavailable(w, r, http.StatusBadGateway, firstNonEmpty(decision.Message, "Preview target is unavailable"))
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
				if !h.Args(&p.BaseDomain) {
					return nil, h.ArgErr()
				}
			case "trusted_requested_host_header":
				if !h.Args(&p.TrustedRequestedHostHeader) {
					return nil, h.ArgErr()
				}
			case "trusted_requested_host_secret_header":
				if !h.Args(&p.TrustedRequestedHostSecretHeader) {
					return nil, h.ArgErr()
				}
			case "trusted_requested_host_secret":
				if !h.Args(&p.TrustedRequestedHostSecret) {
					return nil, h.ArgErr()
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
	if p.trustsRequestedHostHeader(r) {
		requestedHostHeader := firstNonEmpty(
			strings.TrimSpace(p.TrustedRequestedHostHeader),
			defaultTrustedRequestedHostHeader,
		)
		if value := firstForwardedHost(r.Header.Get(requestedHostHeader)); value != "" {
			return normalizePreviewHost(value)
		}
	}
	return normalizePreviewHost(r.Host)
}

func (p *PreviewResolver) trustsRequestedHostHeader(r *http.Request) bool {
	secret := strings.TrimSpace(p.TrustedRequestedHostSecret)
	if secret == "" {
		return false
	}
	secretHeader := firstNonEmpty(strings.TrimSpace(p.TrustedRequestedHostSecretHeader), defaultTrustedRequestedHostSecretHeader)
	presented := strings.TrimSpace(r.Header.Get(secretHeader))
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
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

func parseEncodedPreviewHost(host string, baseDomain string) (previewHostMatch, bool) {
	host = normalizePreviewHost(host)
	if host == "" {
		return previewHostMatch{}, false
	}
	firstLabel, rest, ok := strings.Cut(host, ".")
	if !ok || rest == "" {
		return previewHostMatch{}, false
	}
	if baseDomain != "" && rest != baseDomain {
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
		WorkspaceToken: matches[1],
		RepoSlug:       matches[2],
		SlotSlug:       matches[3],
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

func (p *PreviewResolver) writePreviewStarting(w http.ResponseWriter, r *http.Request) {
	if isPreviewEnsureRequest(r) {
		if p.StartupPage != "" {
			if content, err := os.ReadFile(p.StartupPage); err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write(content)
				return
			}
		}
		p.writePreviewHTML(w, http.StatusServiceUnavailable, "Preview starting", "Preview server is starting. Refresh shortly.")
		return
	}
	p.writePreviewPlain(w, http.StatusServiceUnavailable, "Preview server is starting")
}

func (p *PreviewResolver) writePreviewUnavailable(w http.ResponseWriter, r *http.Request, status int, message string) {
	if isPreviewEnsureRequest(r) {
		p.writePreviewHTML(w, status, http.StatusText(status), message)
		return
	}
	p.writePreviewPlain(w, status, message)
}

func (p *PreviewResolver) writePreviewHTML(w http.ResponseWriter, status int, title string, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, "<!doctype html><html><head><title>%s</title></head><body><h1>%s</h1><p>%s</p></body></html>", html.EscapeString(title), html.EscapeString(title), html.EscapeString(message))
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
