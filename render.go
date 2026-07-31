package main

import (
	"bytes"
	"html/template"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

// markdown renders prompt and assistant-reply content.
//
// This replaces the 78-line hand-rolled parser that used to live in
// static/index.html (renderMarkdown / renderInline). That one recognised only
// fenced code, h1-h3 and simple lists, joined paragraph lines with a space, and
// leaned on a regex with lookahead for emphasis -- which Go's RE2 cannot
// express anyway. goldmark is CommonMark, so output is more correct rather than
// identical to before.
//
// WithUnsafe is deliberately NOT enabled: hook payloads are untrusted input, so
// raw HTML embedded in a prompt must stay escaped rather than render.
var markdownRenderer = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(
		gmhtml.WithHardWraps(),
	),
)

// renderMarkdown converts markdown to HTML that templ can emit verbatim.
// On failure it falls back to the escaped plain text, never to raw input.
func renderMarkdown(src string) template.HTML {
	if src == "" {
		return ""
	}
	var buf bytes.Buffer
	if err := markdownRenderer.Convert([]byte(src), &buf); err != nil {
		return template.HTML(template.HTMLEscapeString(src))
	}
	return template.HTML(buf.String())
}
