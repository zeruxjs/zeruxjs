# Supplemental upstream notices

This directory preserves upstream license texts omitted from installed npm
artifacts. `manifest.json` binds each notice to an exact package name, version,
and declared license, records its upstream source and SHA-256 digest, and explains
the source binding. Identical upstream texts share a content-addressed file.

Some notices come from the project repository rather than the exact package
release; those entries explicitly describe that binding. These records preserve
upstream attribution and do not establish legal compatibility or clearance.

The installed-license inspection checks the digest and rejects unsafe paths,
missing evidence, changed versions, and missing license metadata. Unsupported
optional native packages are reported separately because npm legitimately omits
them on other platforms. Legacy npm `licenses` metadata is accepted as declared.
Missing full notices still fail the strict check.

Current unresolved upstream omissions:

- `postcss-media-query-parser@0.2.3`: declares MIT, but its published artifact and
  upstream source contain no full license notice.
- `keyv@4.5.4`: its installed artifact omits a notice; the currently inspected
  upstream notice omits the MIT permission grant, so it is not accepted as full
  evidence for this release.

When updating dependencies, obtain the complete notice from the publisher,
preserve its text verbatim, and update the exact version binding and digest.
Do not substitute generic license templates for missing upstream attribution.
These repository files do not automatically become part of published packages;
any package distributing bundled third-party code must also preserve the
applicable notices in its published artifact.
