// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package repository

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
)

// richTextBlockElements end a line of text in RichTextPlainText.
var richTextBlockElements = map[string]bool{
	"p": true, "div": true, "br": true, "li": true, "ul": true, "ol": true, "tr": true,
	"table": true, "pre": true, "blockquote": true, "h1": true, "h2": true, "h3": true,
	"h4": true, "h5": true, "h6": true,
}

// RichTextPlainText is the text a reader would see in rich text (HTML the
// editor writes, ServiceNow's journal HTML, or plain text), as plain text: the
// value is parsed as IsBlankRichText parses it, every element is removed with
// its text kept (except the ones whose content DOMPurify drops,
// richTextDroppedContent), character references are decoded, a block element
// or <br> ends a line, runs of spaces collapse to one and blank lines are
// dropped. maxRunes > 0 cuts the result to that many characters, with "…" at
// the end when something was cut. A value the parser refuses comes back as it
// was written (trimmed, and cut the same way).
//
// The result is for display as text (never as HTML): the CAB operations report
// sends ServiceNow-copied approver comments and outage descriptions through it.
func RichTextPlainText(s string, maxRunes int) string {
	doc, err := html.ParseWithOptions(strings.NewReader(s), html.ParseOptionEnableScripting(false))
	if err != nil {
		return cutRunes(strings.TrimSpace(s), maxRunes)
	}
	body := richTextBody(doc)
	if body == nil {
		return ""
	}
	var b strings.Builder
	var visit func(n *html.Node)
	visit = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			switch c.Type {
			case html.TextNode:
				b.WriteString(c.Data)
			case html.ElementNode:
				name := strings.ToLower(c.Data)
				if richTextDroppedContent[name] || richTextSmuggled(c) {
					continue
				}
				visit(c)
				if richTextBlockElements[name] {
					b.WriteByte('\n')
				}
			}
		}
	}
	visit(body)
	var lines []string
	for _, line := range strings.Split(b.String(), "\n") {
		line = strings.Join(strings.FieldsFunc(line, func(r rune) bool { return r == ' ' || isJSWhiteSpace(r) }), " ")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return cutRunes(strings.Join(lines, "\n"), maxRunes)
}

// cutRunes cuts s to maxRunes characters (no cut when maxRunes <= 0), ending
// it with "…" when it was cut.
func cutRunes(s string, maxRunes int) string {
	if maxRunes <= 0 || utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:maxRunes-1])) + "…"
}
