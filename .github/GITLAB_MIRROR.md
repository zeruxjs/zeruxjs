# GitLab branch mirror

`git-sync.yml` pushes each updated GitHub branch to the matching branch in
`gitlab.com:zeruxjs/zeruxjs`. It can also be run manually from Actions. Only
`GIT_SSH_KEY` is required: its public key must have push access to GitLab.

The default host key is pinned in `gitlab_known_hosts`, copied verbatim from
[GitLab's official documentation](https://docs.gitlab.com/user/gitlab_com/#ssh-known_hosts-entries).
Its ED25519 fingerprint is
`SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8`.
The optional existing `GITLAB_KNOWN_HOSTS` secret overrides this file. If GitLab
rotates its host key, verify the replacement through GitLab's official channels
before updating the pinned file. Unknown or changed host keys are rejected.

The mirror creates a GitLab commit whose file tree is exactly the checked-out
GitHub tree. Its parents include both the existing GitLab tip and the GitHub
source commit, preserving both histories even when they have unrelated roots.
Normal pushes update only the matching branch; branches/tags are not deleted
or force-overwritten. Concurrent updates cause a refetch and at most three
normal push attempts. Repeating a completed sync does not add another commit.
A missing private-key secret disables the optional mirror; a missing host-key
secret uses the checked-in public GitLab key instead of failing.

Mirror commits have `[skip-sync]` in their message. The existing `sync` job in
`.gitlab/.gitlab-ci.yml` skips those commits before SSH setup, preventing its
reverse sync from pushing the mirror commit back to GitHub. Other GitLab jobs
are not suppressed. GitLab's configured CI file path and runner settings are
not changed by this workflow.

The failure on 2026-10-17 occurred because the workflow added on 2026-10-15
required `GITLAB_KNOWN_HOSTS`, but that secret was not configured. It stopped
before SSH connection or git push, so it did not test the existing SSH key or
GitLab write permissions.

A read-only history check on 2026-10-18 also found that GitLab's `master`
(`e2578082252fbfb7aff0349e8c209fa62e0eed24`) has 96 commits and no shared
commits with GitHub's current history. Therefore a fast-forward push cannot
repair this mirror until the unrelated histories are intentionally reconciled.
The selected merge-commit approach addresses that difference while retaining
both histories. No GitLab branch or tag was modified during local diagnosis.
