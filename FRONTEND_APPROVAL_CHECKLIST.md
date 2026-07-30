# Frontend Manual Approval Checklist

Use this checklist to approve frontend completeness and button progression. Real OCR/model inference is intentionally excluded from this approval. Processing must create clearly labeled `Model Pending Placeholder` records.

## Test Information

- [ ] Tester name: ______________________________
- [ ] Test date: _________________________________
- [ ] Browser and version: _______________________
- [ ] Device or viewport: ________________________
- [ ] Test URL: `http://127.0.0.1:4173/`
- [ ] Test data/images used: _____________________

## Approval Rules

- [ ] Every required checkbox below passes.
- [ ] No button is unresponsive or leads to a dead end.
- [ ] No page displays overlapping, clipped, or unreadable controls.
- [ ] No blocker or high-severity defect remains open.
- [ ] Placeholder output is visibly identified and is not mistaken for real OCR output.

## 1. Account Setup and Login

- [ ] First launch displays the account setup screen when no local account exists.
- [ ] Required setup fields prevent an incomplete account submission.
- [ ] Password and confirmation mismatch displays a clear warning.
- [ ] Password requirement checklist under the Password field turns green as each rule is met (8+ characters, a letter, a number, a special character).
- [ ] A password that fails any requirement is rejected with a `Weak Password` message listing the unmet rules.
- [ ] Show/hide password buttons work for password fields.
- [ ] `Create Account` saves the local teacher account and proceeds to Login.
- [ ] Correct username and password open the Dashboard.
- [ ] Incorrect login credentials display a clear error.
- [ ] `Remember me` restores the signed-in session after reload when selected.
- [ ] `Forgot password?` opens the password recovery workflow.
- [ ] Security-answer password reset works with a valid answer.
- [ ] Password reset enforces the same password requirements as account setup.
- [ ] `Logout` returns to Login and prevents access to the app shell.

## 2. Dashboard and Navigation

- [ ] Dashboard statistics match the currently stored sessions and results.
- [ ] Recent sessions display date, answer key, sheets, average, flags, and status.
- [ ] `New Answer Key` opens Answer Key Management.
- [ ] `Upload Answer Sheets` opens Upload.
- [ ] `View Results` opens Results.
- [ ] `Reports & Analytics` opens Reports.
- [ ] Every sidebar button opens the correct page.
- [ ] The active sidebar item follows the current page.
- [ ] Global search opens Results and searches student, section, or answer-key data.

## 3. Answer Key Management

- [ ] `New Answer Key` creates an editable draft with starter rows.
- [ ] `Add Item` adds a new editable item row.
- [ ] `Delete Row` removes the selected row or the final row when none is selected.
- [ ] Question type, answer, alternatives, points, threshold, and enumeration group are editable.
- [ ] Invalid enumeration groups display a clear validation error.
- [ ] Empty answer keys cannot be saved.
- [ ] `Save Key` creates a new answer key and displays it in the saved list.
- [ ] Selecting a saved answer key reloads all of its items correctly.
- [ ] Editing and saving an existing key preserves the updated values.
- [ ] `Delete Answer Key` asks for confirmation and removes the selected key only after approval.

## 4. Upload Answer Sheets

- [ ] The answer-key selector lists saved answer keys.
- [ ] When no key exists, `Create Answer Key` opens Answer Key Management.
- [ ] `Browse Images` accepts JPG, JPEG, PNG, BMP, TIF, and TIFF files.
- [ ] `Browse Folder` accepts a browser-selected folder containing supported images.
- [ ] Drag-and-drop accepts supported image files.
- [ ] Unsupported files are skipped and reported clearly.
- [ ] Duplicate files are skipped and reported clearly.
- [ ] Queue counts, total size, and folder count update correctly.
- [ ] Each selected file shows its name, source, path, and size.
- [ ] Each `Remove` button removes only its matching file.
- [ ] `Clear Queue` removes every queued file.
- [ ] `Proceed to Processing` rejects an empty upload queue.
- [ ] `Proceed to Processing` rejects a missing or empty answer key.
- [ ] A valid answer key and valid image queue open Processing.

## 5. Processing Placeholder

- [ ] The page clearly displays `Model Pending Placeholder` before processing.
- [ ] `Start Processing` rejects a missing image queue.
- [ ] `Start Processing` rejects a missing or empty answer key.
- [ ] Starting a valid job creates exactly one processing session.
- [ ] Repeated clicks cannot create duplicate concurrent sessions.
- [ ] The start button is disabled while the job is running.
- [ ] Current filename, completed count, and percentage update during processing.
- [ ] The progress bar reaches 100 percent after all files complete.
- [ ] The log records session creation and each processed file.
- [ ] The Job Details panel displays answer key, item count, image count, and session number.
- [ ] Every uploaded file creates one student result.
- [ ] Every answer-key item creates one flagged result item.
- [ ] Placeholder result items use `model_used: Model Pending Placeholder`.
- [ ] Placeholder answers and remarks clearly state that the model is pending.
- [ ] The completed session status is `Completed`.
- [ ] `Open Results` opens the newly created session.
- [ ] `Back to Upload` returns to Upload.

## 6. Results and Student Result

- [ ] The newest completed session appears automatically in Results.
- [ ] The session selector loads the selected session's student records.
- [ ] Student search filters by name, section, score, or status.
- [ ] Section filtering displays only the selected section.
- [ ] `Refresh` reloads the latest stored values.
- [ ] Clicking a student row visibly selects it.
- [ ] Double-clicking a student row opens Student Result.
- [ ] `Open Student Result` opens the selected student.
- [ ] `Open Student Result` warns when no row is selected.
- [ ] `Review Flagged` opens the selected student's flagged items when available.
- [ ] `Review Flagged` displays `Nothing to Review` when the session has no flags.
- [ ] Student Result displays every item and its auto status, final status, score, remarks, and model.
- [ ] Placeholder Student Result displays the model-pending notice.
- [ ] `Back to Results` returns to the same session.
- [ ] `Review Flagged` is disabled after a student has no remaining flagged items.

## 7. Manual Review Progression

- [ ] Review displays the correct session, student, item number, and question type.
- [ ] Extracted and correct answers are displayed side by side.
- [ ] Automatic status, match score, points, model, and remarks are visible.
- [ ] `Accept as correct` awards full points and removes the flag.
- [ ] `Mark as incorrect` awards zero points and removes the flag.
- [ ] `Override extracted answer` requires a non-empty manual answer.
- [ ] Saving a manual answer awards full points and records a manual override.
- [ ] `Save and Continue` recalculates score, percentage, flag count, and final status.
- [ ] `Save and Continue` automatically opens the next flagged item.
- [ ] Progression continues to the next student when the current student is finished.
- [ ] The page displays `Review Complete` when no flagged items remain.
- [ ] `Back to Results` displays the recalculated values.
- [ ] `Open Last Student` opens the final reviewed student.

## 8. Reports and Exports

- [ ] Reports displays selected-session sheet count, average, flags, and total sessions.
- [ ] Changing the session selector refreshes the report statistics.
- [ ] Every session row displays date, answer key, sheets, average, flags, and status.
- [ ] A session row's `View` button opens that session in Results.
- [ ] `Open Results` opens the currently selected session.
- [ ] `Export Selected Session` and Results `Export Session` use the same export behavior.
- [ ] XLSX export downloads when SheetJS is available and the filename ends in `.xlsx`.
- [ ] CSV export downloads when the filename ends in `.csv`.
- [ ] CSV fallback downloads automatically when SheetJS is unavailable.
- [ ] Filename tokens `{session}`, `{date}`, `{answer_key}`, `{subject}`, and `{section}` are replaced correctly.
- [ ] Invalid filename characters are replaced safely.
- [ ] Student information preference controls student name and section columns.
- [ ] Item-level preference controls the Item Details sheet or CSV section.
- [ ] Total-score preference controls score, total, and percentage columns.
- [ ] Flagged-notes preference controls flags, status, and remarks columns.
- [ ] Question-type preference controls the Type column.

## 9. Settings

- [ ] Account tab loads the current teacher name, institution, and username.
- [ ] Username is read-only.
- [ ] `Save Changes` updates teacher name and institution throughout the app.
- [ ] Password change requires current, new, and confirmation fields.
- [ ] Incorrect current password prevents the password change.
- [ ] New password and confirmation must match.
- [ ] New password must satisfy the same requirements as account setup, shown by the live checklist.
- [ ] Existing accounts created before these requirements can still sign in; the rules apply only when a password is created or changed.
- [ ] Updated password works after logout or reload.
- [ ] `Preview Template` opens a print-ready 20-item answer sheet.
- [ ] `Print Template` opens the browser print action.
- [ ] `Download Template` downloads `ags_exam_template.html`.
- [ ] Export location label and filename format save successfully.
- [ ] Export column checkboxes persist after reload.
- [ ] Ocean Blue, Deep Blue, Forest Green, Purple Haze, and Dark themes are selectable.
- [ ] The active theme is visibly selected.
- [ ] The selected theme persists after reload.
- [ ] About tab displays the correct project and researcher information.

## 10. Responsive and Visual Approval

- [ ] Desktop layout is approved at approximately 1200px width or wider.
- [ ] Tablet layout is approved at approximately 768px width.
- [ ] Mobile layout is approved at approximately 390px width.
- [ ] Mobile menu button opens the sidebar.
- [ ] Selecting a mobile navigation item closes the sidebar.
- [ ] Settings tabs remain reachable by horizontal tab scrolling when necessary.
- [ ] Dashboard and Answer Key columns stack correctly at narrow widths.
- [ ] Upload and Processing side panels stack above their main content on mobile.
- [ ] Wide Results, Reports, Answer Key, and Student Result tables scroll inside their table containers.
- [ ] No page causes whole-window horizontal scrolling.
- [ ] No text overlaps buttons, cards, tables, or nearby content.
- [ ] Buttons remain readable and usable without unexpected resizing.
- [ ] Toast messages and confirmation dialogs fit inside the mobile viewport.

## 11. Persistence and Stability

- [ ] Account profile persists after reload.
- [ ] Saved answer keys and items persist after reload.
- [ ] Completed sessions and reviewed results persist after reload.
- [ ] Theme and export preferences persist after reload.
- [ ] Browser console shows no production JavaScript errors during the complete workflow.
- [ ] Reloading any main page returns the user to a valid login or application state.

## Intentional Exclusions

- [ ] Real YOLO segmentation is not required for this frontend approval.
- [ ] Real TrOCR recognition is not required for this frontend approval.
- [ ] Real CRNN fallback recognition is not required for this frontend approval.
- [ ] Placeholder outputs being flagged is accepted as intentional behavior.
- [ ] Future model integration will replace `ProcessingAdapter.runProcessingJob(...)` without redesigning the frontend workflow.

## Defect Log

| ID | Page | Severity | Description | Status |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |
| 5 |  |  |  |  |

## Final Sign-Off

- [ ] APPROVED: Frontend functionality and button progression are accepted.
- [ ] APPROVED WITH CONDITIONS: Minor defects are documented and accepted temporarily.
- [ ] REJECTED: Required frontend behavior is incomplete or blocked.

Final decision: ______________________________________________

Tester signature: ____________________________________________

Date: _______________________________________________________

Approval notes:

________________________________________________________________

________________________________________________________________

________________________________________________________________
