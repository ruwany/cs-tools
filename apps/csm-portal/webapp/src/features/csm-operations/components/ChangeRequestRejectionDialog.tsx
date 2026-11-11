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

/** The longest comment the backend stores with a decision (characters, once trimmed). */
export const CHANGE_REQUEST_APPROVAL_COMMENT_MAX = 4000;

interface ChangeRequestRejectionDialogProps {
  /** True while the rejection is being sent. */
  isSubmitting: boolean;
  /** The message of the last refused attempt, shown in the dialog so the comment is kept. */
  error?: string | null;
  onClose: () => void;
  /** Called with the trimmed comment, never blank. */
  onConfirm: (comment: string) => void;
}

/**
 * Asks for the approver's reason before a Reject is sent
 * (`POST /change-requests/{id}/approvals/decision`, `comment`). The comment is
 * required; it is stored on the approver's own row and shown in the Comments
 * column of the approvals table (and in the CAB operations dashboard's pushback
 * list). Approve has no dialog: it is sent on the click, with no comment.
 */
export default function ChangeRequestRejectionDialog({
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: ChangeRequestRejectionDialogProps): JSX.Element {
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = comment.trim();
  // Counted in characters (code points), as the backend counts them.
  const length = Array.from(trimmed).length;
  const tooLong = length > CHANGE_REQUEST_APPROVAL_COMMENT_MAX;
  const canSubmit = !isSubmitting && !tooLong && length > 0;

  return (
    <Dialog
      open
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      maxWidth="xs"
      fullWidth
      aria-labelledby="cr-rejection-title"
      aria-describedby="cr-rejection-body"
      // Focus the field once the dialog has opened (the clicked row button keeps
      // focus otherwise, as in ChangeRequestTransitionReasonDialog).
      slotProps={{ transition: { onEntered: () => commentRef.current?.focus() } }}
    >
      <DialogTitle id="cr-rejection-title">Reject this change request?</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <DialogContentText id="cr-rejection-body" variant="body2">
            Your rejection is recorded on your row of this approval stage. One rejection rejects the stage.
          </DialogContentText>
          <TextField
            label="Comment"
            required
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
                : "Required. Say why, so the requester knows what to change."
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
          color="error"
          onClick={() => onConfirm(trimmed)}
          disabled={!canSubmit}
          loading={isSubmitting}
        >
          Reject
        </Button>
      </DialogActions>
    </Dialog>
  );
}
