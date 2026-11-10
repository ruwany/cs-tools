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

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@wso2/oxygen-ui";
import { useRef, useState, type JSX } from "react";
import type { BeChangeRequestApprovalDecision } from "@api/backend/types";

/** The longest comment the backend stores with a decision (characters, once trimmed). */
export const CHANGE_REQUEST_APPROVAL_COMMENT_MAX = 4000;

interface DecisionCopy {
  title: string;
  body: string;
  confirmLabel: string;
  confirmColor: "success" | "error";
  helper: string;
}

const COPY: Record<BeChangeRequestApprovalDecision, DecisionCopy> = {
  approved: {
    title: "Approve this change request?",
    body: "Your approval is recorded on your row of this approval stage.",
    confirmLabel: "Approve",
    confirmColor: "success",
    helper: "Optional. For example, what should be checked before the change goes ahead.",
  },
  rejected: {
    title: "Reject this change request?",
    body: "Your rejection is recorded on your row of this approval stage. One rejection rejects the stage.",
    confirmLabel: "Reject",
    confirmColor: "error",
    helper: "Required. Say why, so the requester knows what to change.",
  },
};

interface ChangeRequestApprovalDecisionDialogProps {
  decision: BeChangeRequestApprovalDecision;
  /** True while the decision is being sent. */
  isSubmitting: boolean;
  /** The message of the last refused attempt, shown in the dialog so the comment is kept. */
  error?: string | null;
  onClose: () => void;
  /** Called with the trimmed comment ("" for none: only an approval may have none). */
  onConfirm: (comment: string) => void;
}

/**
 * Asks for the approver's comment before an Approve / Reject is sent
 * (`POST /change-requests/{id}/approvals/decision`, `comment`). The comment is
 * optional to approve and required to reject; it is stored on the approver's own
 * row and shown in the Comments column of the approvals table (and in the CAB
 * operations dashboard's pushback list).
 */
export default function ChangeRequestApprovalDecisionDialog({
  decision,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: ChangeRequestApprovalDecisionDialogProps): JSX.Element {
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const copy = COPY[decision];
  const required = decision === "rejected";
  const trimmed = comment.trim();
  // Counted in characters (code points), as the backend counts them.
  const length = Array.from(trimmed).length;
  const tooLong = length > CHANGE_REQUEST_APPROVAL_COMMENT_MAX;
  const canSubmit = !isSubmitting && !tooLong && (!required || length > 0);

  return (
    <Dialog
      open
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      maxWidth="xs"
      fullWidth
      aria-labelledby="cr-approval-decision-title"
      aria-describedby="cr-approval-decision-body"
      // Focus the field once the dialog has opened (the clicked row button keeps
      // focus otherwise, as in ChangeRequestTransitionReasonDialog).
      slotProps={{ transition: { onEntered: () => commentRef.current?.focus() } }}
    >
      <DialogTitle id="cr-approval-decision-title">{copy.title}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <DialogContentText id="cr-approval-decision-body" variant="body2">
            {copy.body}
          </DialogContentText>
          <TextField
            label="Comment"
            required={required}
            inputRef={commentRef}
            multiline
            minRows={3}
            fullWidth
            size="small"
            value={comment}
            disabled={isSubmitting}
            error={tooLong}
            onChange={(e) => setComment(e.target.value)}
            helperText={
              tooLong
                ? `At most ${CHANGE_REQUEST_APPROVAL_COMMENT_MAX} characters (${length} now).`
                : copy.helper
            }
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={isSubmitting}>
          Go back
        </Button>
        <Button
          variant="contained"
          color={copy.confirmColor}
          onClick={() => onConfirm(trimmed)}
          disabled={!canSubmit}
          loading={isSubmitting}
        >
          {copy.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
