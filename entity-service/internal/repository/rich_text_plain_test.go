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

import "testing"

func TestRichTextPlainText(t *testing.T) {
	for _, tc := range []struct {
		in   string
		max  int
		want string
	}{
		{"plain words", 0, "plain words"},
		{"  spaced   out\ttext ", 0, "spaced out text"},
		{"<p>Add the <b>rollback</b> steps.</p><p>Then resubmit.</p>", 0, "Add the rollback steps.\nThen resubmit."},
		{"line one<br>line two", 0, "line one\nline two"},
		{"<ul><li>one</li><li>two</li></ul>", 0, "one\ntwo"},
		{"a &amp; b &lt;c&gt;&nbsp;d", 0, "a & b <c> d"},
		{"<p>keep</p><script>alert(1)</script><style>p{}</style>", 0, "keep"},
		{"<p><br></p><p>&nbsp;</p>", 0, ""},
		{"", 0, ""},
		{"abcdefghij", 5, "abcd…"},
		{"abcde", 5, "abcde"},
	} {
		if got := RichTextPlainText(tc.in, tc.max); got != tc.want {
			t.Errorf("RichTextPlainText(%q, %d) = %q, want %q", tc.in, tc.max, got, tc.want)
		}
	}
}

// TestApproverCommentText: a plain comment (typed in the portal) is kept as
// typed; only one holding an editor's markup is read as rich text.
func TestApproverCommentText(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"  Add the <env> name to step 3 ", "Add the <env> name to step 3"},
		{"Check List<String> handling", "Check List<String> handling"},
		{"Do not use <script> here.\nSee the runbook.", "Do not use <script> here.\nSee the runbook."},
		{"Type &lt; literally", "Type &lt; literally"},
		{"   ", ""},
		{"", ""},
		{"<p>Add the <b>rollback</b> steps.</p>", "Add the rollback steps."},
		{"No <B>rollback</B> plan&nbsp;", "No rollback plan"},
		{"first line<br/>second", "first line\nsecond"},
		{"<p><br></p>", ""},
	} {
		if got := ApproverCommentText(tc.in); got != tc.want {
			t.Errorf("ApproverCommentText(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestIsCABStageForReport pins the report's CAB-stage rule to the one the
// approvals list uses (changeRequestApprovalStageLabel + classifyApprovalStage).
func TestIsCABStageForReport(t *testing.T) {
	s := func(v string) *string { return &v }
	cab := s("CAB Approval")
	devops := s("Devops Approval")
	for _, tc := range []struct {
		name         string
		label, group *string
		pos          int
		model        string
		want         bool
	}{
		{"labelled CAB", s("CAB Approval"), devops, 0, "NORMAL", true},
		{"older Authorize label", s("Authorize"), nil, 0, "NORMAL", true},
		{"older ECAB label", s("ECAB Approval"), nil, 0, "EMERGENCY", true},
		{"labelled peer", s("Peer Approval"), cab, 1, "NORMAL", false},
		{"labelled review", s("Review"), cab, 1, "NORMAL", false},
		{"customer approval", s("Customer Approval"), nil, 1, "NORMAL", false},
		{"unlabelled second stage", nil, devops, 1, "NORMAL", true},
		{"unlabelled first stage", nil, devops, 0, "NORMAL", false},
		{"unlabelled third stage", nil, cab, 2, "NORMAL", false},
		{"unlabelled emergency in CAB group", nil, cab, 0, "EMERGENCY", true},
		{"unlabelled emergency elsewhere at 0", nil, devops, 0, "EMERGENCY", false},
		{"empty label is unlabelled", s(""), nil, 1, "", true},
	} {
		if got := isCABStageForReport(tc.label, tc.group, tc.pos, tc.model); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
