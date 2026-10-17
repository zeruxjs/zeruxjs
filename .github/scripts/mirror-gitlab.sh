#!/usr/bin/env bash
# Mirror the checked-out GitHub tree while retaining GitLab and GitHub ancestry.
# Globals: GITHUB_REF_NAME, GITHUB_REPOSITORY and optional GITHUB_STEP_SUMMARY.
# Requires an authenticated gitlab remote; never prints credentials or forces refs.
set -euo pipefail

branch=${GITHUB_REF_NAME:?Missing GitHub branch name}
repository=${GITHUB_REPOSITORY:?Missing GitHub repository name}
git check-ref-format --branch "$branch" >/dev/null
target_ref="refs/heads/$branch"
source_commit=$(git rev-parse HEAD)
source_tree=$(git rev-parse 'HEAD^{tree}')

for attempt in 1 2 3; do
  target_commit=''
  if remote_ref=$(git ls-remote --exit-code gitlab "$target_ref"); then
    git fetch --no-tags gitlab "$target_ref"
    target_commit=$(git rev-parse FETCH_HEAD)
  else
    status=$?
    if [[ $status -ne 2 ]]; then
      echo 'Unable to read GitLab branch; check SSH access and GitLab availability.' >&2
      exit "$status"
    fi
  fi

  if [[ -n "$target_commit" ]] &&
    git merge-base --is-ancestor "$source_commit" "$target_commit" &&
    [[ $(git rev-parse "$target_commit^{tree}") == "$source_tree" ]]; then
    echo "GitLab $branch already contains GitHub source $source_commit with identical files."
    exit 0
  fi

  # Select GitHub's complete tree explicitly; both parents retain their histories.
  # This also supports unrelated roots without resolving file conflicts by deletion.
  parents=()
  if [[ -n "$target_commit" ]]; then parents+=(-p "$target_commit"); fi
  parents+=(-p "$source_commit")
  mirror_commit=$(
    printf '[skip-sync] Mirror GitHub %s:%s\n\nGitHub source: %s\nGitLab previous: %s\n' \
      "$repository" "$branch" "$source_commit" "${target_commit:-none}" |
      git -c user.name='github-actions[bot]' \
        -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
        commit-tree "$source_tree" "${parents[@]}"
  )

  echo "Mirroring GitHub $source_commit to GitLab $branch (attempt $attempt/3)."
  # GitLab's previous tip is a parent, so a normal push preserves remote history.
  if git push gitlab "$mirror_commit:$target_ref"; then
    echo "Mirror complete: GitHub source $source_commit; GitLab commit $mirror_commit; identical file tree $source_tree."
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      printf '## GitLab mirror complete\n\n- Branch: `%s`\n- GitHub source: `%s`\n- GitLab merge commit: `%s`\n- Identical file tree: `%s`\n- Both histories retained; no force push.\n' \
        "$branch" "$source_commit" "$mirror_commit" "$source_tree" >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi

  # Refetch after a concurrent push instead of overwriting the changed remote tip.
  if [[ $attempt -lt 3 ]]; then sleep "$((attempt * 2))"; fi
done

echo 'GitLab mirror failed after three normal push attempts; remote history was not force-overwritten.' >&2
exit 1
