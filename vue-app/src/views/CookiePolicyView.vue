<script setup>
/* ============================================================
   CookiePolicyView.vue — plain-language cookie/local-storage
   disclosure. DRAFT, not reviewed by a lawyer.

   Kept accurate to what the app actually sets, not a generic
   template: one functional session cookie (backend/app/main.py's
   SessionMiddleware) and one localStorage key for theme preference
   (services/theme.js via the legacy database.js settings store).
   No analytics/advertising cookies exist, which is why this page
   states no consent banner is used -- update this page immediately
   if that ever changes.
   ============================================================ */
</script>

<template>
  <div class="legal-page">
    <h1 class="page-title">Cookie Policy</h1>
    <div class="legal-updated">Last updated: this is a project document — update the date when you edit it.</div>

    <div class="legal-notice">
      This is a draft written for a thesis prototype, not a substitute for legal advice.
    </div>

    <h2>What this system actually uses</h2>
    <p>Exactly two small pieces of browser storage, and nothing else:</p>
    <ul>
      <li><strong>A session cookie</strong> — keeps you signed in between page loads. Strictly
        necessary for the system to function; there is no way to use the system while signed in
        without it.</li>
      <li><strong>A local storage entry for your theme preference</strong> — remembers your chosen
        color theme on this device. It never leaves your browser and is not sent to the server.</li>
    </ul>

    <h2>No consent banner, and here's why</h2>
    <p>
      This system does not use analytics, advertising, or tracking cookies of any kind — nothing
      that profiles you, follows you across sites, or is used for marketing. Under the Philippine
      Data Privacy Act and comparable frameworks, a cookie consent banner is meant for exactly that
      kind of non-essential tracking; it is not required for cookies that are strictly necessary
      for the service to work, which is the only kind used here. That's why there is no cookie
      banner in this app — there is nothing optional to opt into.
    </p>

    <h2>Third-party cookies</h2>
    <p>
      None are set by this system. One third-party script (SheetJS, used to build Excel exports
      entirely in your own browser) is loaded from its own CDN, but it does not set cookies or
      track you — it only serves the script file itself.
    </p>

    <h2>Managing this yourself</h2>
    <p>
      Clearing your browser's cookies or local site data will sign you out and reset your theme to
      default. Since the session cookie is required to use the system at all, blocking it entirely
      will prevent sign-in.
    </p>

    <RouterLink :to="{ name: 'login' }" class="legal-back">&larr; Back to login</RouterLink>
  </div>
</template>
