// Package vibekanbanplugins implements Caddy HTTP handlers that rewrite
// specific snippets in proxied responses.
package vibekanbanplugins

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

var (
	embeddedCheckSnippet = []byte("window.self!==window.top")
	embeddedCheckPatch   = []byte("false")
)

type rewriteMode string

const (
	rewriteModeVibeKanban   rewriteMode = "vibe_kanban"
	rewriteModeBeadsWeb     rewriteMode = "beads_web"
	rewriteModeBeadsWebHost rewriteMode = "beads_web_host"
)

func init() {
	caddy.RegisterModule(PluginInjector{})
	httpcaddyfile.RegisterHandlerDirective("vk_rewrite", parseCaddyfile)
	httpcaddyfile.RegisterDirectiveOrder("vk_rewrite", "before", "reverse_proxy")
}

// PluginInjector rewrites specific proxied response snippets.
type PluginInjector struct {
	Mode rewriteMode `json:"mode,omitempty"`

	logger *zap.Logger
}

// CaddyModule returns the Caddy module information.
func (PluginInjector) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.vibe_kanban_rewriter",
		New: func() caddy.Module { return new(PluginInjector) },
	}
}

// parseCaddyfile sets up the handler from Caddyfile tokens.
//
// Syntax:
//
//	vk_rewrite
//	vk_rewrite vibe_kanban
//	vk_rewrite beads_web
//	vk_rewrite beads_web_host
//
// No argument preserves the original vibe-kanban iframe rewrite behavior.
func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	p := PluginInjector{Mode: rewriteModeVibeKanban}

	for h.Next() {
		args := h.RemainingArgs()
		if len(args) > 1 {
			return nil, h.ArgErr()
		}
		if len(args) == 1 {
			switch rewriteMode(args[0]) {
			case rewriteModeVibeKanban, rewriteModeBeadsWeb, rewriteModeBeadsWebHost:
				p.Mode = rewriteMode(args[0])
			default:
				return nil, h.Errf("unsupported vk_rewrite mode %q", args[0])
			}
		}
	}

	return &p, nil
}

// Provision implements caddy.Provisioner.
func (p *PluginInjector) Provision(ctx caddy.Context) error {
	p.logger = ctx.Logger(p)
	if p.Mode == "" {
		p.Mode = rewriteModeVibeKanban
	}
	return nil
}

// responseRecorder buffers the upstream response for processing.
type responseRecorder struct {
	http.ResponseWriter
	statusCode  int
	headers     http.Header
	body        *bytes.Buffer
	wroteHeader bool
}

// newResponseRecorder creates a new response recorder.
func newResponseRecorder(w http.ResponseWriter) *responseRecorder {
	return &responseRecorder{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
		headers:        make(http.Header),
		body:           new(bytes.Buffer),
	}
}

// Header implements http.ResponseWriter.
func (r *responseRecorder) Header() http.Header {
	return r.headers
}

// Write implements http.ResponseWriter.
func (r *responseRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	return r.body.Write(b)
}

// WriteHeader implements http.ResponseWriter.
func (r *responseRecorder) WriteHeader(statusCode int) {
	if !r.wroteHeader {
		r.statusCode = statusCode
		r.wroteHeader = true
	}
}

// Hijack implements http.Hijacker interface.
func (r *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not support hijacking")
	}
	return hijacker.Hijack()
}

// Flush implements http.Flusher interface.
func (r *responseRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// isUpgradeRequest checks if the request is attempting to upgrade protocols.
func isUpgradeRequest(r *http.Request) bool {
	upgrade := r.Header.Get("Upgrade")
	connection := r.Header.Get("Connection")
	return upgrade != "" || strings.Contains(strings.ToLower(connection), "upgrade")
}

// ServeHTTP implements caddyhttp.MiddlewareHandler.
func (p *PluginInjector) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if isUpgradeRequest(r) {
		if p.logger != nil {
			p.logger.Debug("bypassing rewrite for protocol upgrade request",
				zap.String("upgrade", r.Header.Get("Upgrade")),
				zap.String("connection", r.Header.Get("Connection")))
		}
		return next.ServeHTTP(w, r)
	}

	rec := newResponseRecorder(w)
	if err := next.ServeHTTP(rec, r); err != nil {
		return err
	}

	processedBody, rewritten := p.processResponse(r.URL.Path, rec.headers, rec.body.Bytes())

	for key, values := range rec.headers {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	if rewritten {
		w.Header().Del("ETag")
		w.Header().Del("Content-MD5")
		w.Header().Del("Accept-Ranges")
	}

	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(processedBody)))
	w.WriteHeader(rec.statusCode)

	if p.shouldWriteResponseBody(r.Method, rec.statusCode) {
		_, _ = w.Write(processedBody)
	}

	return nil
}

// shouldWriteResponseBody determines if a response body should be written
// based on HTTP method and status code semantics.
func (p *PluginInjector) shouldWriteResponseBody(method string, statusCode int) bool {
	if method == http.MethodHead {
		return false
	}

	if statusCode >= 100 && statusCode < 200 {
		return false
	}

	if statusCode == http.StatusNoContent {
		return false
	}

	if statusCode == http.StatusNotModified {
		return false
	}

	return true
}

// processResponse rewrites matching proxied responses when possible.
func (p *PluginInjector) processResponse(path string, headers http.Header, body []byte) ([]byte, bool) {
	if headers.Get("Content-Encoding") != "" {
		return body, false
	}

	contentType := headers.Get("Content-Type")
	switch p.Mode {
	case rewriteModeBeadsWeb:
		if !isJavaScriptResponse(path, contentType) && !isHTMLResponse(path, contentType) && !isNextDataResponse(path, contentType) {
			return body, false
		}
		return p.rewriteBeadsWebSubpath(body)
	case rewriteModeBeadsWebHost:
		if !isJavaScriptResponse(path, contentType) && !isHTMLResponse(path, contentType) && !isNextDataResponse(path, contentType) {
			return body, false
		}
		return p.rewriteBeadsWebHost(body)
	default:
		if !isJavaScriptResponse(path, contentType) {
			return body, false
		}
		return p.rewriteVibeKanbanJavaScript(body)
	}
}

func isJavaScriptResponse(path string, contentType string) bool {
	contentTypeLower := strings.ToLower(contentType)
	if strings.Contains(contentTypeLower, "javascript") || strings.Contains(contentTypeLower, "ecmascript") {
		return true
	}

	pathLower := strings.ToLower(path)
	return strings.HasSuffix(pathLower, ".js") ||
		strings.HasSuffix(pathLower, ".mjs") ||
		strings.HasSuffix(pathLower, ".cjs")
}

func isHTMLResponse(path string, contentType string) bool {
	contentTypeLower := strings.ToLower(contentType)
	if strings.Contains(contentTypeLower, "text/html") {
		return true
	}

	pathLower := strings.ToLower(path)
	return strings.HasSuffix(pathLower, ".html") || pathLower == "/" || pathLower == ""
}

func isNextDataResponse(path string, contentType string) bool {
	contentTypeLower := strings.ToLower(contentType)
	if strings.Contains(contentTypeLower, "text/x-component") {
		return true
	}

	pathLower := strings.ToLower(path)
	return strings.HasSuffix(pathLower, ".txt")
}

// rewriteVibeKanbanJavaScript replaces a frame-detection snippet with a constant false.
func (p *PluginInjector) rewriteVibeKanbanJavaScript(js []byte) ([]byte, bool) {
	count := bytes.Count(js, embeddedCheckSnippet)
	if count == 0 {
		return js, false
	}

	rewritten := bytes.ReplaceAll(js, embeddedCheckSnippet, embeddedCheckPatch)

	if p.logger != nil {
		p.logger.Debug("rewrote JavaScript snippet",
			zap.Int("replacements", count),
			zap.String("from", string(embeddedCheckSnippet)),
			zap.String("to", string(embeddedCheckPatch)))
	}

	return rewritten, true
}

// rewriteBeadsWebSubpath adapts the upstream beads-web build for hosting under
// /beads. beads-web currently has no runtime base-path support: exported Next.js
// pages use absolute /_next assets, client navigation points at /project and
// /settings, and browser API calls default to http://localhost:3008. Caddy handles
// /_next directly; these replacements keep app navigation and API calls scoped to
// the /beads and /beads-api prefixes.
func (p *PluginInjector) rewriteBeadsWebSubpath(body []byte) ([]byte, bool) {
	replacements := []struct {
		from string
		to   string
	}{
		{`http://localhost:3008`, `/beads-api`},
		{`href="/"`, `href="/beads/"`},
		{`href="/settings"`, `href="/beads/settings"`},
		{`href=\"/\"`, `href=\"/beads/\"`},
		{`href=\"/settings\"`, `href=\"/beads/settings\"`},
		{`"/project?id=`, `"/beads/project?id=`},
		{`'/project?id=`, `'/beads/project?id=`},
		{`href:"/"`, `href:"/beads/"`},
		{`href:"/settings"`, `href:"/beads/settings"`},
		{`urlParts:["","project"]`, `urlParts:["","beads","project"]`},
		{`urlParts":["","project"]`, `urlParts":["","beads","project"]`},
		{`urlParts:["","settings"]`, `urlParts:["","beads","settings"]`},
		{`urlParts":["","settings"]`, `urlParts":["","beads","settings"]`},
	}

	rewritten := body
	total := 0
	for _, replacement := range replacements {
		from := []byte(replacement.from)
		count := bytes.Count(rewritten, from)
		if count == 0 {
			continue
		}
		rewritten = bytes.ReplaceAll(rewritten, from, []byte(replacement.to))
		total += count
	}

	if total == 0 {
		return body, false
	}

	if p.logger != nil {
		p.logger.Debug("rewrote beads-web subpath response", zap.Int("replacements", total))
	}

	return rewritten, true
}

// rewriteBeadsWebHost adapts the upstream beads-web build for a dedicated
// beads-web.<domain> host. In this mode Next.js assets and client routes stay at
// /, so only the compiled browser API origin needs to become same-origin.
func (p *PluginInjector) rewriteBeadsWebHost(body []byte) ([]byte, bool) {
	const from = `http://localhost:3008`
	count := bytes.Count(body, []byte(from))
	if count == 0 {
		return body, false
	}

	rewritten := bytes.ReplaceAll(body, []byte(from), []byte(``))

	if p.logger != nil {
		p.logger.Debug("rewrote beads-web host response", zap.Int("replacements", count))
	}

	return rewritten, true
}

var (
	_ caddy.Provisioner           = (*PluginInjector)(nil)
	_ caddyhttp.MiddlewareHandler = (*PluginInjector)(nil)
	_ http.ResponseWriter         = (*responseRecorder)(nil)
	_ http.Hijacker               = (*responseRecorder)(nil)
	_ http.Flusher                = (*responseRecorder)(nil)
)
