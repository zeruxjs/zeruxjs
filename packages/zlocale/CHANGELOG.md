# Changelog

## 0.0.3

- Add an explicit allowlisted locale controller with last-selection-wins behavior.
- Validate complete locale/domain sets before installation; safely ignore stale loads, errors and disposed selections.
- Include the changelog in published artifacts.

## 0.0.2

- Add bounded, versioned catalog snapshots for SSR hydration and explicit transport.
- Escape HTML delimiters in JSON data blocks and reject duplicate catalog identities.
- Add zlocale to the reviewed workspace API freeze and validate GitHub trusted publishing with this release.

## 0.0.1

- Initial i18n/l10n runtime, native Intl formatting, bounded loading, request isolation and Zyro adapter.
