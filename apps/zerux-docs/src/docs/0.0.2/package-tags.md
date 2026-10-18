---
{
  "title": "Browser and server tagging",
  "description": "Manage consent-aware events and approved destinations without arbitrary script execution.",
  "section": "Packages",
  "order": 22,
  "sources": [
    "packages/@zeruxjs/tags/README.md",
    "packages/@zeruxjs/tags/package.json"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/tags"
}
---

## The service boundary

Tags connect browser ttag, request-scoped server astag, trigger definitions and approved destinations. The default internal analytics tag records matching events; GA4 Measurement Protocol and approved HTTPS webhooks execute server-side so destination credentials do not enter public container JSON.

## Browser collection

Load the configured /_tags/ttag.js route after establishing an intentional consent policy. Use ttag event/set/get/consent operations. Denied consent discards queued events. Browser events are delivered asynchronously and best effort; a generated request ID does not prove delivery or legal consent.

## Server context

Create astag for a request with a trusted site and approved identity context. Do not share one mutable astag singleton across users. Use a shared database request-ID store for cross-replica uniqueness and siteByOrigin for public tenant binding.

## Studio and releases

Admin routes require host authorization; writes need same-origin checks and optimistic versions. Publish/preview controls and bounded release snapshots do not replace transactional control-plane storage at large scale. No arbitrary browser JavaScript/HTML tags are executed.

## Egress

Destination timeouts isolate failures, but HTTPS hostname validation alone does not remove DNS rebinding risk. Deploy outbound DNS/IP allowlists and firewall rules. Google HTTP acceptance is not proof of GA4 processing. Email marketing consent is independent of telemetry consent.
