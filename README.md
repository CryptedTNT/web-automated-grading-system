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

## Testing and debugging (for developers)

The app ships with an optional debug mode that provides a throwaway admin account
and sample data, so you can exercise the app without clicking through setup and
uploads every time. **It is off by default and nothing runs unless you turn it on.**

### Turning it on

Open the app with `?debug=1` in the address bar:

```
index.html?debug=1
```

A purple debug bar appears at the bottom of the page with buttons for the common
actions. The flag is remembered in this browser, so later visits stay in debug
mode without the query string.

Add `&autologin=1` to skip the sign-in screen entirely:

```
index.html?debug=1&autologin=1
```

### Turning it off

Open `index.html?debug=0`, or press the `×` on the debug bar. The flag is cleared
and the app returns to normal behaviour.

### The debug account

| Field | Value |
| --- | --- |
| Username | `admin` |
| Password | `Admin@123` |

The account is **created on demand**, not on page load — it appears the first time
you use *Log in as admin* or `autologin=1`. This keeps debug mode out of the way of
the real signup flow: opening `?debug=1` on a fresh browser still shows the normal
account setup screen, with the debug tools available alongside it.

If you change this account's password in Settings, *Log in as admin* stops working
(it uses a fixed password, not a bypass). It will say so and ask you to sign in
manually or reset.

### Console helpers

Debug mode exposes `window.AGSDebug`:

| Call | What it does |
| --- | --- |
| `AGSDebug.login()` | Create the debug account if needed and sign in |
| `AGSDebug.seedSampleData(3)` | Create an answer key (10 items, all four question types) plus a completed session of N graded sheets |
| `AGSDebug.dumpState()` | Log and return a snapshot of accounts, answer keys, sessions, results, and settings |
| `AGSDebug.resetGrading()` | Delete all answer keys, sessions, and results, but keep accounts |
| `AGSDebug.resetAll()` | Delete everything and return to the account setup screen |
| `AGSDebug.disable()` | Turn off debug mode |

Both reset actions ask for confirmation first and then reload the page.

Sample data is generated through the same processing pipeline the app uses for real
uploads, so seeded results arrive flagged for review — useful for testing the
Review Flagged and Reports pages.

### A note on scope

This is a convenience account, not a permission system. The app stores everything
in the browser's local storage and has no server, so there are no roles and no
privileged actions — the debug account is an ordinary teacher account with a known
password. Any real access control would need a backend.

