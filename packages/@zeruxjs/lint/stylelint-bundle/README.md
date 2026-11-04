# Stylelint security bundle

Private build input for the lint package. The pinned dependency tree replaces vulnerable `braces` with the inspected `@zklogic/braces@3.0.7` fork. `npm ci --ignore-scripts` prepares the dependencies that npm bundles in the parent archive. This directory is not published independently.

The SCSS media-query parser is replaced by the repository-owned adapter archive
in `vendor/`, with complete MIT and Apache-2.0 notices. The adapter is internal
and bundled, and needs no separate registry publication. The override references
the private build's explicit local dependency; bundle preparation mirrors the
repository layout so its archive path resolves identically.
The adapter's private compatibility version is `0.2.3`, satisfying the plugin's
existing dependency range. Public package versions are defined in their own manifests.
