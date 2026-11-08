# Accessibility

ZeruxJS aims to be useful to people with different abilities, devices, languages, and ways of interacting with software. People should be able to learn about the project, contribute to it, and use the interfaces built and maintained by the project without avoidable barriers.

This statement covers accessibility priorities, expectations for contributors, how to report barriers, how reports are handled, ownership, supported environments, and known limitations. It applies to project-controlled experiences in the [ZeruxJS repository](https://github.com/zeruxjs/zeruxjs), its [website and documentation](https://zeruxjs.shubkb.me/), examples and development applications, interactive components, command-line tools, and the ZeruxJS/ZyroJS VS Code extension where applicable. It does not claim that every application built with ZeruxJS is accessible; application developers remain responsible for their own interfaces and content.

Accessibility is an ongoing responsibility, not a finished certification. **No project-wide accessibility audit or verified conformance claim is made by this statement.**

## Priorities

Our goal is to make essential project tasks possible without relying on a specific input method, sensory ability, or presentation style. We prioritize:

1. **Keyboard access and visible focus.** Navigation, menus, dialogs, examples, search, forms, and other interactive features should work without a mouse. Focus must be visible and move in a meaningful order, without keyboard traps.
2. **Screen-reader compatibility and meaningful structure.** Use headings, landmarks, accessible names, labels, status messages, and native HTML controls wherever practical. Dynamic updates should be understandable without relying only on their visual appearance.
3. **Readable and adaptable content.** Use descriptive links, clear instructions and errors, sufficient contrast, scalable text, logical reading order, and layouts that work with zoom and small screens. Avoid using color alone to communicate meaning.
4. **Motion, media, and sensory preferences.** Respect reduced-motion preferences, provide control over nonessential animation, and provide text alternatives for meaningful images, diagrams, and audio/video content when introduced.
5. **Developer tooling and terminal access.** CLI prompts, output, errors, and progress indicators should remain understandable with keyboard navigation, terminal screen readers, or redirected/noninteractive output. Avoid color-only statuses and provide useful text alternatives where appropriate.
6. **Localization and plain language.** Prefer understandable documentation and messages; identify document language and support text expansion and different writing directions where relevant. Translations may be contributed as their maintenance can be supported.
7. **Accessible defaults for reusable components.** Framework examples and UI-oriented packages should encourage semantic markup and sensible focus, labeling, and error-handling patterns, while clearly documenting the responsibilities of applications using them.

We use **WCAG 2.2 Level AA as an aspirational reference** for project-controlled web interfaces and documentation—not as a statement that any page, package, or product has been evaluated or conforms. A future conformance statement would identify the exact scope, version/date, testing methods, and evaluator.

## Contributor expectations

Every contribution should avoid introducing new accessibility barriers. The scope of review should match what the change actually affects. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

For **web, UI, CSS, or interactive examples**, contributors should:

- Prefer semantic HTML and native controls; use ARIA only where it helps rather than replacing built-in behavior.
- Give controls accessible names, visible labels, usable instructions, and understandable errors; associate validation feedback with relevant fields.
- Ensure keyboard operation, logical focus order, and visible focus; when dialogs open or close, manage focus sensibly.
- Check that meaning does not depend on color, shape, hover, animation, sound, or a pointer alone.
- Consider zoom, smaller viewports, text resizing, contrast, reduced motion, and touch or alternative input.
- Ensure changes do not hide useful information from assistive technologies or announce excessive irrelevant updates.

For **documentation, tutorials, and media**, contributors should:

- Use logical headings, descriptive link text, readable code examples, and clear language.
- Include useful alternative text for informative images, and text explanations for diagrams and important visual steps.
- Include captions or transcripts for instructional media when those materials are added.
- Avoid instructions that assume everyone can see a screenshot, distinguish colors, hear audio, or use a mouse.

For **CLI tools, developer experiences, and extension features**, contributors should:

- Make prompts and errors understandable without color or icons; provide plain output where appropriate.
- Avoid requiring an interactive terminal when a documented noninteractive option is suitable.
- Use descriptive labels and messages for extension commands, status, menus, and editor features when those are exposed to users.

### Verification and pull requests

Include the following in a pull request whenever relevant:

- **Affected experience:** Which package, page, component, command, documentation topic, or editor interaction changed?
- **User impact:** What task became easier, remained usable, or could be affected?
- **Checks performed:** For visual changes, describe keyboard and focus checks, zoom or responsive checks, and any screen-reader checks actually completed. For docs, describe heading, link, and text-alternative checks. For CLI changes, describe keyboard and plain-output checks.
- **Evidence:** Include reproduction steps or short notes, with optional screenshots, recordings, or test output. Do not upload personal or sensitive information.
- **Gaps:** Identify checks that were not run and why, plus any follow-up work.

Use the [default pull request template](.github/PULL_REQUEST_TEMPLATE.md) or the [accessibility-specific template](.github/PULL_REQUEST_TEMPLATE/accessibility.md). Automated linting and other CI checks may help identify problems where configured, but a passing check does **not** establish accessibility or replace human checks. This policy does not claim that a particular accessibility scanner or assistive-technology test is currently running in CI.

## Reporting accessibility issues

If something in ZeruxJS prevents you from completing a task or makes it unnecessarily difficult, please tell us. You do not need to know the cause, cite a standard, or disclose a disability.

**Report an accessibility barrier:** [Open an accessibility issue](https://github.com/zeruxjs/zeruxjs/issues/new?template=accessibility.yml). If that form is unavailable or difficult to use, [open a regular GitHub issue](https://github.com/zeruxjs/zeruxjs/issues/new) and start the title with `Accessibility:`. You can also use an [existing issue](https://github.com/zeruxjs/zeruxjs/issues) if the same problem has already been reported. GitHub issue submission generally requires a GitHub account.

Tell us whatever is comfortable and useful, such as:

- What you were trying to do, and where (page URL, package, file, command, or editor feature).
- What happened, what you expected, and whether the task is blocked or only more difficult.
- Steps to reproduce, if known.
- Your browser, operating system, device, input method, or assistive technology **if you want to share them**.
- Any workaround that helped.

Screenshots, recordings, logs, and technical details are **optional**. Do not include passwords, access tokens, personal records, or private data. If the report reveals an exploitable security flaw or sensitive information, follow [SECURITY.md](SECURITY.md) instead of posting those details publicly. If using GitHub itself is a barrier, ask a trusted person to submit the report on your behalf; we recognize this is not an equivalent independent reporting channel, and we intend to improve it when a verified alternative becomes available.

### Severity

Reporters do **not** need to select a severity. Maintainers will assess impact with the affected user experience in mind:

| Severity | Meaning | Example |
| --- | --- | --- |
| **Critical** | An essential task is impossible for a group of users, with no practical workaround. | A keyboard-only user cannot access the primary navigation or submit a required form. |
| **High** | An important task is blocked or only possible through a difficult, unreliable workaround. | A required dialog cannot be operated by a screen reader. |
| **Medium** | The task can be completed, but the barrier causes substantial effort, confusion, or loss of information. | Form errors are visible but not announced or connected to the right fields. |
| **Low** | A localized usability or content issue with limited impact on completing tasks. | A secondary icon has unclear alternative text, while an equivalent labeled control is available. |

Severity reflects real impact and may change during investigation. These categories guide prioritization; they are **not** guaranteed response or fix deadlines.

### How we respond

- Maintainers will review reports as part of regular issue triage, ask clarifying questions only where needed, and identify the affected project surface.
- When a workaround or alternate way to get the information is known, we will try to share it in the issue.
- We will indicate whether the report is confirmed, needs more information, is planned, or cannot currently be addressed, and explain important changes of status when possible.
- Fixes may be linked to a pull request or release, and reporters are welcome to verify whether the original task works afterward. Verification is optional.
- **No fixed acknowledgement or resolution time is currently guaranteed.** Priority depends on impact, maintainers' availability, release constraints, and safe implementation.

We welcome reports written in plain language. Please be respectful in discussions; the project's [Code of Conduct](CODE_OF_CONDUCT.md) applies.

## Ownership and maintenance

The **ZeruxJS repository maintainers** are responsible for accessibility triage, prioritization, and review of changes to project-controlled interfaces and documentation. Contributors working on a particular package or app are expected to address accessibility in their changes, with maintainers reviewing cross-package implications.

Maintainers should review this statement **at least every six months**, and when major user-facing experiences or reporting routes change. During review, they should check issue links, ownership, supported-environment notes, known barriers, and the accuracy of any testing claims. If maintainership changes, the incoming maintainers should take responsibility for open accessibility reports and update this document or its links as appropriate. These are maintenance expectations, not a claim about reviews already completed.

## Supported environments

ZeruxJS includes different kinds of surfaces. The intended experiences and testing status differ:

| Surface | Intended environments and ways of using it | Current verification status |
| --- | --- | --- |
| **Website and documentation** | Modern desktop and mobile browsers; keyboard, pointer, touch, zoom, and assistive technologies such as screen readers. | No comprehensive browser/device/assistive-technology support matrix or dated accessibility audit is published in this statement. Specific combinations must be verified before claiming support. |
| **Example applications and UI components** | The browsers and platforms identified by each example or package; keyboard and alternative input when interactive. | May differ by example or package. Do not assume all combinations have been tested. |
| **Node.js command-line tools** | Supported Node.js runtimes and terminal environments as defined by each package; interactive keyboard use and noninteractive output when available. | CLI accessibility has not been verified across terminal/screen-reader combinations here. |
| **VS Code extension** | VS Code environments covered by the extension's own compatibility metadata; keyboard and editor accessibility features. | No extension-specific screen-reader compatibility audit is claimed here. |
| **Documentation and development collaboration on GitHub** | Browsers and assistive technologies supported by GitHub's platform. | GitHub is a third-party platform; its accessibility support and limitations are separate from ZeruxJS's own testing. |

Potential test combinations include current stable Chrome/Chromium, Firefox, Safari, and Edge; Windows with NVDA; macOS or iOS with VoiceOver; and Android with TalkBack. **These are candidates for future validation, not combinations we claim to have tested or certified.** Contributors should report the exact versions used when reporting test results.

## Known limitations

This document does not yet reference a completed accessibility audit, a published device/assistive-technology test matrix, or a verified list of all barriers in project-controlled interfaces. **That lack of documented findings does not mean there are no accessibility problems.**

Current areas needing explicit verification include:

- The full keyboard and screen-reader experience of the project website and documentation, including navigation, theme controls, search, code examples, and any animations.
- Interactive examples and framework-generated UI, whose behavior may vary by package or consumer application.
- Terminal prompts, error output, and accessibility of the VS Code extension across different environments.
- Third-party content or services embedded in, linked from, or used to collaborate on the project.

Where a barrier is confirmed, maintainers should track it in [GitHub issues](https://github.com/zeruxjs/zeruxjs/issues) and document a workaround or equivalent path when possible. For now, a user may be able to access written documentation in GitHub's Markdown view, use a noninteractive CLI option if the specific command supports one, or request a textual explanation of a visual example. **These are possible alternatives, not guaranteed solutions.** Report a broken workaround as an accessibility issue.

## Feedback and improvements

Suggestions for clearer guidance, better contribution practices, additional accessibility checks, or changes to this statement are welcome through [GitHub issues](https://github.com/zeruxjs/zeruxjs/issues/new) or a pull request. For a barrier affecting a real task, use the [accessibility reporting route](#reporting-accessibility-issues) so it can be triaged. When proposing changes to the policy, explain the affected user experience and avoid describing unverified tests as completed.

See also [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).
