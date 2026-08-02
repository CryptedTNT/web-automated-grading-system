# Automated Grading System

A web-based system for grading handwritten objective examinations. Teachers create an answer key, upload scanned answer sheets, review the results, and export a report to Excel.

## Opening the app

Open the app in a web browser. On first use you will be asked to create a teacher account. Your account is saved in the browser you set it up in, so use the same browser and device to sign back in.

## What's New

### Password requirements

New passwords are now checked as you type. A short list under the password box shows each requirement, turning green once it is met:

- At least 8 characters
- At least 1 letter
- At least 1 number
- At least 1 special character

If a requirement is not met, the account or password change is not saved and a message tells you what is missing. The same rules apply when creating an account, resetting a forgotten password, and changing your password in Settings.

Accounts made before this update still work. The new rules apply the next time a password is created or changed.

### Redesigned sign-in screen

The sign-in, account setup, and password reset screens were resized so the form has more room:

- On phones and tablets, the dark branding panel is now a slim bar across the top instead of filling most of the screen.
- On computers, the sign-in box and branding panel are the same width and sit centered on the page.

## Main features

- Create and manage answer keys
- Upload scanned or photographed answer sheets
- Automatic grading with a review step for uncertain answers
- Student scores with item-by-item detail
- Export results to Excel

---

### A note on scope

This is a convenience account, not a permission system. The app stores everything
in the browser's local storage and has no server, so there are no roles and no
privileged actions — the debug account is an ordinary teacher account with a known
password. Any real access control would need a backend.

