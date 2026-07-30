package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// The raw-payload drawer renders a JSON tree. The JS version walked the parsed
// object with Object.keys, which preserves insertion order; decoding into a Go
// map would randomise it and reshuffle the tree on every render. So the payload
// is decoded with a token stream that keeps the original key order.

type jsonKind string

const (
	jsonObject jsonKind = "object"
	jsonArray  jsonKind = "array"
	jsonScalar jsonKind = "scalar"
)

// jsonNode is one node of the decoded payload.
type jsonNode struct {
	Kind jsonKind
	// Display is the rendered text for a scalar: quoted for strings, bare for
	// numbers and booleans, "null" for null. Matches JSON.stringify.
	Display string
	// Class is the CSS class for a scalar's value span.
	Class string
	// Keys is the object's key order; empty for arrays and scalars.
	Keys []string
	// Children are the object values (parallel to Keys) or the array items.
	Children []jsonNode
}

// Label is the collapsed-node summary, e.g. "Object(3)" / "Array(0)".
func (n jsonNode) Label() string {
	switch n.Kind {
	case jsonObject:
		return fmt.Sprintf("Object(%d)", len(n.Keys))
	case jsonArray:
		return fmt.Sprintf("Array(%d)", len(n.Children))
	}
	return n.Display
}

// ChildPath returns the JSON path of the i-th child, e.g. `$.tool_input[0]`.
func (n jsonNode) ChildPath(parent string, i int) string {
	if n.Kind == jsonArray {
		return fmt.Sprintf("%s[%d]", parent, i)
	}
	if i < len(n.Keys) {
		return parent + "." + n.Keys[i]
	}
	return parent
}

// parseJSONNode decodes raw JSON preserving object key order.
func parseJSONNode(raw []byte) (jsonNode, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return jsonNode{}, err
	}
	return decodeJSONNode(dec, tok)
}

func decodeJSONNode(dec *json.Decoder, tok json.Token) (jsonNode, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			node := jsonNode{Kind: jsonObject}
			for {
				keyTok, err := dec.Token()
				if err != nil {
					return node, err
				}
				if d, ok := keyTok.(json.Delim); ok && d == '}' {
					return node, nil
				}
				key, _ := keyTok.(string)
				valTok, err := dec.Token()
				if err != nil {
					return node, err
				}
				child, err := decodeJSONNode(dec, valTok)
				if err != nil {
					return node, err
				}
				node.Keys = append(node.Keys, key)
				node.Children = append(node.Children, child)
			}
		case '[':
			node := jsonNode{Kind: jsonArray}
			for {
				itemTok, err := dec.Token()
				if err != nil {
					return node, err
				}
				if d, ok := itemTok.(json.Delim); ok && d == ']' {
					return node, nil
				}
				child, err := decodeJSONNode(dec, itemTok)
				if err != nil {
					return node, err
				}
				node.Children = append(node.Children, child)
			}
		}
		return jsonNode{}, fmt.Errorf("unexpected delimiter %v", t)
	case string:
		encoded, err := json.Marshal(t)
		if err != nil {
			return jsonNode{}, err
		}
		return jsonNode{Kind: jsonScalar, Display: string(encoded), Class: "json-string"}, nil
	case json.Number:
		return jsonNode{Kind: jsonScalar, Display: t.String(), Class: "json-number"}, nil
	case bool:
		return jsonNode{Kind: jsonScalar, Display: fmt.Sprintf("%t", t), Class: "json-boolean"}, nil
	case nil:
		return jsonNode{Kind: jsonScalar, Display: "null", Class: "json-null"}, nil
	}
	return jsonNode{}, fmt.Errorf("unsupported token %T", tok)
}

// ---------- Search highlighting ----------

// textSegment is a run of text that is either matched by the drawer's search
// term or not. Splitting first and escaping per segment fixes a bug in the JS
// original, which escaped the whole string and then ran the regex over the
// result -- so a match could land inside an entity like `&amp;` and produce
// broken markup.
type textSegment struct {
	Text  string
	Match bool
}

func highlightSegments(text, term string) []textSegment {
	if term == "" || text == "" {
		return []textSegment{{Text: text}}
	}
	lowerText, lowerTerm := strings.ToLower(text), strings.ToLower(term)
	var out []textSegment
	for {
		i := strings.Index(lowerText, lowerTerm)
		if i < 0 {
			break
		}
		if i > 0 {
			out = append(out, textSegment{Text: text[:i]})
		}
		out = append(out, textSegment{Text: text[i : i+len(term)], Match: true})
		text, lowerText = text[i+len(term):], lowerText[i+len(term):]
	}
	if text != "" {
		out = append(out, textSegment{Text: text})
	}
	return out
}
