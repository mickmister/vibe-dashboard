package vibekanbanplugins

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func mockNextHandler(body []byte, statusCode int, headers http.Header) caddyhttp.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		for key, values := range headers {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(statusCode)
		_, _ = w.Write(body)
		return nil
	}
}

func TestServeHTTPRewritesJavaScriptSnippet(t *testing.T) {
	originalJS := []byte(`if(window.self!==window.top){console.log('embedded');}`)
	upstream := mockNextHandler(originalJS, http.StatusOK, http.Header{
		"Content-Type":  []string{"application/javascript; charset=utf-8"},
		"ETag":          []string{`"original-etag"`},
		"Accept-Ranges": []string{"bytes"},
	})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	want := []byte(`if(false){console.log('embedded');}`)
	if !bytes.Equal(rec.Body.Bytes(), want) {
		t.Fatalf("unexpected rewritten body\nwant: %s\n got: %s", want, rec.Body.Bytes())
	}

	if got := rec.Header().Get("Content-Length"); got != fmt.Sprintf("%d", len(want)) {
		t.Fatalf("unexpected content length: got %s want %d", got, len(want))
	}

	if got := rec.Header().Get("ETag"); got != "" {
		t.Fatalf("expected rewritten response ETag to be cleared, got %q", got)
	}

	if got := rec.Header().Get("Accept-Ranges"); got != "" {
		t.Fatalf("expected rewritten response Accept-Ranges to be cleared, got %q", got)
	}
}

func TestServeHTTPRewritesJavaScriptByPathWhenContentTypeIsMissing(t *testing.T) {
	originalJS := []byte(`export const embedded=window.self!==window.top;`)
	upstream := mockNextHandler(originalJS, http.StatusOK, http.Header{})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodGet, "/assets/app.mjs", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	want := []byte(`export const embedded=false;`)
	if !bytes.Equal(rec.Body.Bytes(), want) {
		t.Fatalf("unexpected rewritten body\nwant: %s\n got: %s", want, rec.Body.Bytes())
	}
}

func TestServeHTTPLeavesOtherJavaScriptUnchanged(t *testing.T) {
	originalJS := []byte(`console.log('plain js');`)
	upstream := mockNextHandler(originalJS, http.StatusOK, http.Header{
		"Content-Type": []string{"text/javascript"},
	})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if !bytes.Equal(rec.Body.Bytes(), originalJS) {
		t.Fatalf("expected body to be unchanged\nwant: %s\n got: %s", originalJS, rec.Body.Bytes())
	}
}

func TestServeHTTPSkipsNonJavaScriptResponses(t *testing.T) {
	html := []byte(`<html><body><script>window.self!==window.top</script></body></html>`)
	upstream := mockNextHandler(html, http.StatusOK, http.Header{
		"Content-Type": []string{"text/html; charset=utf-8"},
	})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodGet, "/index.html", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if !bytes.Equal(rec.Body.Bytes(), html) {
		t.Fatalf("expected non-JS body to be unchanged\nwant: %s\n got: %s", html, rec.Body.Bytes())
	}
}

func TestServeHTTPSkipsCompressedResponses(t *testing.T) {
	compressedJS := []byte(`window.self!==window.top`)
	upstream := mockNextHandler(compressedJS, http.StatusOK, http.Header{
		"Content-Type":     []string{"application/javascript"},
		"Content-Encoding": []string{"gzip"},
	})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if !bytes.Equal(rec.Body.Bytes(), compressedJS) {
		t.Fatalf("expected compressed body to be unchanged\nwant: %s\n got: %s", compressedJS, rec.Body.Bytes())
	}
}

func TestServeHTTPOmitsBodyForHeadRequests(t *testing.T) {
	originalJS := []byte(`window.self!==window.top`)
	upstream := mockNextHandler(originalJS, http.StatusOK, http.Header{
		"Content-Type": []string{"application/javascript"},
	})

	injector := &PluginInjector{}
	req := httptest.NewRequest(http.MethodHead, "/assets/app.js", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if rec.Body.Len() != 0 {
		t.Fatalf("expected HEAD response body to be empty, got %q", rec.Body.Bytes())
	}

	if got := rec.Header().Get("Content-Length"); got != fmt.Sprintf("%d", len("false")) {
		t.Fatalf("unexpected content length for HEAD response: got %s", got)
	}
}

func TestServeHTTPBeadsWebModeRewritesSubpathReferences(t *testing.T) {
	body := []byte(`<a href="/settings">Settings</a><script>const api="http://localhost:3008";router.push("/project?id="+id);</script>`)
	upstream := mockNextHandler(body, http.StatusOK, http.Header{
		"Content-Type": []string{"text/html; charset=utf-8"},
		"ETag":         []string{`"original-etag"`},
	})

	injector := &PluginInjector{Mode: rewriteModeBeadsWeb}
	req := httptest.NewRequest(http.MethodGet, "/beads/", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	want := []byte(`<a href="/beads/settings">Settings</a><script>const api="/beads-api";router.push("/beads/project?id="+id);</script>`)
	if !bytes.Equal(rec.Body.Bytes(), want) {
		t.Fatalf("unexpected rewritten body\nwant: %s\n got: %s", want, rec.Body.Bytes())
	}

	if got := rec.Header().Get("ETag"); got != "" {
		t.Fatalf("expected rewritten response ETag to be cleared, got %q", got)
	}
}

func TestServeHTTPBeadsWebModeSkipsCompressedResponses(t *testing.T) {
	body := []byte(`const api="http://localhost:3008";`)
	upstream := mockNextHandler(body, http.StatusOK, http.Header{
		"Content-Type":     []string{"application/javascript"},
		"Content-Encoding": []string{"gzip"},
	})

	injector := &PluginInjector{Mode: rewriteModeBeadsWeb}
	req := httptest.NewRequest(http.MethodGet, "/_next/static/app.js", nil)
	rec := httptest.NewRecorder()

	if err := injector.ServeHTTP(rec, req, upstream); err != nil {
		t.Fatalf("ServeHTTP returned error: %v", err)
	}

	if !bytes.Equal(rec.Body.Bytes(), body) {
		t.Fatalf("expected compressed body to be unchanged\nwant: %s\n got: %s", body, rec.Body.Bytes())
	}
}
