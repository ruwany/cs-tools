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

package domain

// The CAB operations report (GET /reports/cab-operations): what the CAB was
// asked to decide over a date range, and how it decided. One change request
// counts once, in the period of its LATEST CAB stage ("asked on": the stage's
// created_on, the day the CAB was asked; the database records no CAB meeting).
// Every date is UTC.

// CABOperationsOutcome is what the CAB did with a change request's latest CAB
// stage.
type CABOperationsOutcome string

const (
	// CABOperationsOutcomeApproved: a CAB member approved the stage (and nobody
	// rejected it).
	CABOperationsOutcomeApproved CABOperationsOutcome = "APPROVED"
	// CABOperationsOutcomeRejected: a CAB member rejected the stage.
	CABOperationsOutcomeRejected CABOperationsOutcome = "REJECTED"
	// CABOperationsOutcomePending: nobody has decided yet and the change request
	// is still waiting for the CAB (state Authorize).
	CABOperationsOutcomePending CABOperationsOutcome = "PENDING"
	// CABOperationsOutcomeCancelled: nobody decided and the change request is no
	// longer waiting for the CAB (it was cancelled or moved on without a CAB
	// decision being recorded).
	CABOperationsOutcomeCancelled CABOperationsOutcome = "CANCELLED"
)

// CABOperationsPushbackKind says what a pushback item is.
type CABOperationsPushbackKind string

const (
	// CABOperationsPushbackRejection is a CAB member's rejection (with or
	// without a comment).
	CABOperationsPushbackRejection CABOperationsPushbackKind = "REJECTION"
	// CABOperationsPushbackComment is a CAB member's comment on any other
	// decision (an approval with "add the verification steps" is pushback too).
	CABOperationsPushbackComment CABOperationsPushbackKind = "COMMENT"
)

// Change model buckets of the report ("normal" / "standard" / "emergency";
// every other change_model value, or none, is "other").
const (
	CABOperationsModelNormal    = "normal"
	CABOperationsModelStandard  = "standard"
	CABOperationsModelEmergency = "emergency"
	CABOperationsModelOther     = "other"
)

// CABOperationsReportRequest is the query of GET /reports/cab-operations.
// From and To are inclusive YYYY-MM-DD dates (UTC); empty takes the defaults
// (the last four calendar months, this one included, up to today).
type CABOperationsReportRequest struct {
	From string
	To   string
}

// CABOperationsModelCounts counts change requests by change model.
type CABOperationsModelCounts struct {
	Normal    int `json:"normal"`
	Standard  int `json:"standard"`
	Emergency int `json:"emergency"`
	Other     int `json:"other"`
}

// CABOperationsCounts is the figures of a set of change requests (a month, or
// the whole period).
type CABOperationsCounts struct {
	Total     int `json:"total"`
	Approved  int `json:"approved"`
	Rejected  int `json:"rejected"`
	Pending   int `json:"pending"`
	Cancelled int `json:"cancelled"`
	// ApprovalRate is approved / (approved + rejected), from 0 to 1; null when
	// the CAB decided none.
	ApprovalRate *float64 `json:"approvalRate"`
	// Prod counts the change requests with a primary production deployment.
	Prod int `json:"prod"`
	// OutageDeclared counts the change requests whose "Service outage /
	// downtime" field is filled in. Whether the outage is full or partial is not
	// recorded.
	OutageDeclared int                      `json:"outageDeclared"`
	ByModel        CABOperationsModelCounts `json:"byModel"`
}

// CABOperationsNamedCount is a count for one named thing (a team).
type CABOperationsNamedCount struct {
	// ID is nil for change requests that have none (no assignment group).
	ID    *string `json:"id"`
	Name  string  `json:"name"`
	Count int     `json:"count"`
}

// CABOperationsTotals is the whole period's figures.
type CABOperationsTotals struct {
	CABOperationsCounts
	// Approvers is how many different CAB members decided at least once.
	Approvers int `json:"approvers"`
}

// CABOperationsMonth is one calendar month of the period.
type CABOperationsMonth struct {
	// Month is YYYY-MM.
	Month string `json:"month"`
	CABOperationsCounts
	// Ongoing is true for the current month: its figures are so far only.
	Ongoing bool `json:"ongoing"`
	// TopTeams is the month's three busiest assignment groups.
	TopTeams []CABOperationsNamedCount `json:"topTeams"`
}

// CABOperationsDay is one day of the period (every day is listed, zero or not).
type CABOperationsDay struct {
	// Day is YYYY-MM-DD.
	Day            string `json:"day"`
	Total          int    `json:"total"`
	Approved       int    `json:"approved"`
	Rejected       int    `json:"rejected"`
	Prod           int    `json:"prod"`
	OutageDeclared int    `json:"outageDeclared"`
	Standard       int    `json:"standard"`
	Emergency      int    `json:"emergency"`
}

// CABOperationsWeek is one ISO week (Monday to Sunday) overlapping the period.
type CABOperationsWeek struct {
	// WeekStart is the Monday, YYYY-MM-DD.
	WeekStart string                   `json:"weekStart"`
	Total     int                      `json:"total"`
	ByModel   CABOperationsModelCounts `json:"byModel"`
	// ByTeam has one entry per CABOperationsReport.WeeklyTeams team, in that
	// order; OtherTeams counts the rest (no group included).
	ByTeam     []CABOperationsNamedCount `json:"byTeam"`
	OtherTeams int                       `json:"otherTeams"`
}

// CABOperationsTeamRef names one assignment group.
type CABOperationsTeamRef struct {
	ID   *string `json:"id"`
	Name string  `json:"name"`
}

// CABOperationsCustomer is one customer account's intake.
type CABOperationsCustomer struct {
	// AccountID is nil for change requests with no customer project.
	AccountID *string `json:"accountId"`
	Name      string  `json:"name"`
	Total     int     `json:"total"`
	Approved  int     `json:"approved"`
	Rejected  int     `json:"rejected"`
	Standard  int     `json:"standard"`
	Emergency int     `json:"emergency"`
}

// CABOperationsTeam is one assignment group's figures. The database records no
// delivery stream, so the assignment group stands in for one.
type CABOperationsTeam struct {
	// GroupID is nil for change requests with no assignment group.
	GroupID        *string  `json:"groupId"`
	Name           string   `json:"name"`
	Total          int      `json:"total"`
	Approved       int      `json:"approved"`
	Rejected       int      `json:"rejected"`
	ApprovalRate   *float64 `json:"approvalRate"`
	OutageDeclared int      `json:"outageDeclared"`
	Standard       int      `json:"standard"`
	Emergency      int      `json:"emergency"`
}

// CABOperationsApprover is one CAB member's workload: their decisions on the
// CAB stages of the period's change requests (every CAB stage of each, not
// only the latest).
type CABOperationsApprover struct {
	UserID    *string `json:"userId"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	Decisions int     `json:"decisions"`
	Approved  int     `json:"approved"`
	Rejected  int     `json:"rejected"`
	// Comments counts their non-blank comments.
	Comments int `json:"comments"`
}

// CABOperationsRequester is one person who raised change requests the CAB was
// asked about.
type CABOperationsRequester struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Total  int    `json:"total"`
}

// CABOperationsQueueItem is a change request waiting for the CAB.
type CABOperationsQueueItem struct {
	ID          string `json:"id"`
	Number      string `json:"number"`
	Subject     string `json:"subject"`
	AccountName string `json:"accountName"`
	Model       string `json:"model"`
	// Environment is the deployment type (PRIMARY_PRODUCTION when any of its
	// deployments is one), "" when it has no deployment.
	Environment    string  `json:"environment"`
	PlannedStart   *string `json:"plannedStart"`
	OutageDeclared bool    `json:"outageDeclared"`
	// AskedOn is when the CAB was asked (RFC 3339).
	AskedOn string `json:"askedOn"`
	// Approvers is the CAB members still asked (names), in the order asked.
	Approvers []string `json:"approvers"`
}

// CABOperationsRegistryItem is one change request of the period.
type CABOperationsRegistryItem struct {
	ID              string `json:"id"`
	Number          string `json:"number"`
	Subject         string `json:"subject"`
	State           string `json:"state"`
	AccountName     string `json:"accountName"`
	Model           string `json:"model"`
	Environment     string `json:"environment"`
	AssignmentGroup string `json:"assignmentGroup"`
	RequestedBy     string `json:"requestedBy"`
	OutageDeclared  bool   `json:"outageDeclared"`
	// OutageSummary is the start of the declared outage text (plain text,
	// at most 300 characters), "" when none is declared.
	OutageSummary string               `json:"outageSummary"`
	Outcome       CABOperationsOutcome `json:"outcome"`
	DecidedBy     string               `json:"decidedBy"`
	DecidedOn     *string              `json:"decidedOn"`
	// CABComment is the latest non-blank comment on any of its CAB stages, as
	// plain text.
	CABComment   string  `json:"cabComment"`
	AskedOn      string  `json:"askedOn"`
	PlannedStart *string `json:"plannedStart"`
}

// CABOperationsPushbackItem is a CAB rejection or a CAB comment.
type CABOperationsPushbackItem struct {
	ChangeRequestID string                    `json:"changeRequestId"`
	Number          string                    `json:"number"`
	Subject         string                    `json:"subject"`
	AccountName     string                    `json:"accountName"`
	Kind            CABOperationsPushbackKind `json:"kind"`
	// Decision is the approver row's state (APPROVED, REJECTED, ...).
	Decision     string `json:"decision"`
	ApproverName string `json:"approverName"`
	// Comment is plain text, "" for a rejection without one.
	Comment   string `json:"comment"`
	DecidedOn string `json:"decidedOn"`
}

// CABOperationsMember is a member of the "CAB Approval" group who may decide
// a CAB stage (an active internal user).
type CABOperationsMember struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Email  string `json:"email"`
}

// CABOperationsReport is the response of GET /reports/cab-operations.
type CABOperationsReport struct {
	// From and To are the inclusive period, YYYY-MM-DD (UTC).
	From string `json:"from"`
	To   string `json:"to"`
	// GeneratedOn is when the report was built (RFC 3339).
	GeneratedOn string `json:"generatedOn"`
	// CurrentMonth is the month of GeneratedOn, YYYY-MM: the ongoing one.
	CurrentMonth string                 `json:"currentMonth"`
	Totals       CABOperationsTotals    `json:"totals"`
	Months       []CABOperationsMonth   `json:"months"`
	Daily        []CABOperationsDay     `json:"daily"`
	WeeklyTeams  []CABOperationsTeamRef `json:"weeklyTeams"`
	Weekly       []CABOperationsWeek    `json:"weekly"`
	// Customers is sorted by total, highest first.
	Customers []CABOperationsCustomer `json:"customers"`
	// Teams is sorted by total, highest first.
	Teams []CABOperationsTeam `json:"teams"`
	// Approvers is sorted by decisions, highest first.
	Approvers []CABOperationsApprover `json:"approvers"`
	// Requesters is the ten who raised the most.
	Requesters []CABOperationsRequester `json:"requesters"`
	// Queue is oldest asked first.
	Queue []CABOperationsQueueItem `json:"queue"`
	// Registry is newest asked first, at most CABOperationsRegistryCap rows;
	// RegistryTotal is the full count and Truncated says rows were left out.
	Registry      []CABOperationsRegistryItem `json:"registry"`
	RegistryTotal int                         `json:"registryTotal"`
	Truncated     bool                        `json:"truncated"`
	// Pushback is newest first, at most CABOperationsPushbackCap items;
	// PushbackTotal is the full count.
	Pushback      []CABOperationsPushbackItem `json:"pushback"`
	PushbackTotal int                         `json:"pushbackTotal"`
	CABMembers    []CABOperationsMember       `json:"cabMembers"`
}

// Caps of the report's lists.
const (
	CABOperationsRegistryCap = 2000
	CABOperationsPushbackCap = 200
	// CABOperationsMaxMonths is the longest period, in calendar months.
	CABOperationsMaxMonths = 24
)
