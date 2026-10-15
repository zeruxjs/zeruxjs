# Security Policy

## Supported Versions

ZeruxJS ecosystem packages are versioned independently. **No stable 1.x release is certified yet.** Current alpha/beta packages are under active development and receive fixes on a best-effort basis, not a guaranteed stable security-support SLA. Do not interpret a successful local source test as stable publication approval.

| Package versions | Security support |
| --- | --- |
| Current prerelease branches (for example `0.0.1-alpha.x`) | Best effort; no guaranteed support window |
| Current released `0.x` packages | Best effort until an explicit support matrix is published |
| `1.x` (not released/certified yet) | Not applicable |
| Older prereleases | Not supported |

After the first stable npm publication, replace this table with exact supported version lines and EOL dates. See `RELEASE_DECISION_85.md` for the current release state.

## Reporting a Vulnerability

**Do not post proof-of-concepts, secrets or vulnerability details in public GitHub issues.** Report confidentially using the repository's [GitHub security advisory reporting](https://github.com/zeruxjs/zeruxjs/security/advisories/new). The repository maintainers must enable private vulnerability reporting in GitHub Settings → Code security if it is not available.

Include the affected package/version, reproducible steps, impact and a safe proof-of-concept when possible. Maintainers will triage and coordinate a fix and disclosure. Until an explicit security-response SLA is published, response and resolution times are not guaranteed. Never use a placeholder or unverified security-reporting email address.

A reported issue may be accepted, declined with an explanation or held for more information; no automatic public disclosure is implied.
