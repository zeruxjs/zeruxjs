# Stylelint security bundle

Private build input for the lint package. The pinned dependency tree replaces vulnerable `braces` with the inspected `@zklogic/braces@3.0.7` fork. `npm ci --ignore-scripts` prepares the dependencies that npm bundles in the parent archive. This directory is not published independently.
