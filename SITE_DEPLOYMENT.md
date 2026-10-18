# Shared static sites and master-site

Source code stays on `master`. The GitHub Actions workflow builds static files, publishes them to **`master-site`**, and deploys the complete output tree to GitHub Pages. The branch is also suitable for any static host that serves a Git branch without another build step.

## URL and branch layout

```text
master-site
├── index.html                 / shared ecosystem homepage
├── site-assets/               homepage CSS and optional browser code
├── zeruxjs/
│   ├── index.html             /zeruxjs/ documentation portal
│   ├── docs/0.0.2/...          versioned documentation
│   ├── assets/                documentation CSS, JS and search data
│   └── 404.html
├── 404.html                   shared missing-page response
├── robots.txt
├── site-manifest.json         configured site ownership
└── .nojekyll
```

Future sites receive their own `/{site}/` folder. `/` remains the common home for the framework, libraries, CMS, packages and future projects. The root catalog comes from public non-sample workspace manifests; private/sample packages are excluded.

## Development commands

After installing repository dependencies, run from `pages/`:

```sh
npm run dev
```

Open `http://127.0.0.1:3010/` and `http://127.0.0.1:3010/zeruxjs/`. The server rebuilds changed homepage/app sources and reloads open browser tabs after a successful build. It keeps the prior export available when content validation fails. Renderer/config changes restart the Node watch process. `HOST` and `PORT` select a different local listener.

```sh
npm run build
npm run preview
```

The combined build is written to `.site-build/` at the repository root. Each app still supports its own development/build commands. Generated files are ignored by source Git.

## GitHub Actions

`.github/workflows/github-pages-deploy.yml` runs for relevant changes pushed to `master` and supports manual runs from that branch:

1. Install locked dependencies with package lifecycle scripts disabled. Build Zuixs and the TypeScript, performance and search workspace tooling in parallel. The exporter does not build the full framework runtime or native database adapters.
2. Build all apps declared in `sites.config.mjs` concurrently, with live START/READY logs.
3. Generate the shared homepage and validate cross-site links, assets and anchors.
4. Create/update `master-site` through a temporary worktree and a **normal push**, preserving its history.
5. Upload the complete static branch tree, including other preserved site folders.
6. Deploy that exact artifact to GitHub Pages. The Actions summary lists branch commit, source commit and each site's path.

The job uses the built-in `GITHUB_TOKEN`; no personal access token or npm publishing token is required. Deployment happens in this workflow rather than relying on the token-created branch commit to trigger another Pages build.

In repository **Settings → Pages**, select **GitHub Actions** as the source. The desired domain-root URLs require a custom domain (or an account-site repository). A normal `zeruxjs/zeruxjs` project Pages URL otherwise has a repository prefix; it is not the domain-root hosting layout requested here. Configure your real domain and its DNS in Pages, or point another static host at `master-site` with `/` as its publish root. No domain has been invented or changed by these scripts.

Existing `CNAME` and other unowned files on the output branch are preserved. In Actions-based Pages deployments, configure the custom domain in repository settings. Set the docs' public `site.origin` to that domain origin when enabling canonical URLs and its sitemap.

## Add another site

Add a disjoint entry to `sites.config.mjs`:

```js
{
  id: 'zyrojs',
  mount: '/zyrojs',
  directory: 'apps/zyro-docs',
  build: ['node', 'scripts/build.mjs'],
  watch: ['src', 'public', 'scripts'],
  output: 'dist/zyrojs'
}
```

Use the real app directory, build command and static output folder. Configure the app's own renderer/router/assets/search to use `/zyrojs/`; copying a root-only build into a folder does not fix its internal URLs. Builds run in the app directory without a shell. Node scripts work across development platforms; npm commands in this Linux workflow can also be declared when needed.

The combined builder places that output at `.site-build/zyrojs/`. The publisher owns and refreshes only `/zyrojs/` for that app. Workflow path filters already include `apps/**`, so a new app does not need another deploy workflow. Add its public link/card to `pages/index.html` when ready.

Mounted paths must be unique single segments: `/{for}`. The root source owns only the explicit `root.owned` files in the configuration. Existing unowned paths are preserved, including folders for independently deployed sites. Removing a configured site does **not** silently delete its previously published folder; retirement is a deliberate separate operation.

## Verification and recovery

App builds validate their content. The combined builder checks the complete new site's internal paths, then the publisher checks the merged tree, including preserved sites, **before committing or pushing**. Non-fast-forward pushes fail rather than overwriting concurrent changes. Re-run the workflow to fetch the current output branch and retry. Unchanged output produces no extra commit.

A GitHub Pages settings/deployment failure does not lose the successfully published `master-site` build; fix the setting and rerun. No source branch is force-pushed. `.site-published/` and temporary worktrees are generated staging, not source files to commit.

Site tooling uses the current checkout, including unpublished changes: the locked install links local npm workspaces, CI verifies the real paths of Zuixs and the TypeScript/performance/search packages under `packages/`, then builds those sources before building any site. Only external dependencies come from the npm registry. There is no need to publish these workspace changes first.

## Markdown stays Markdown

The published tree includes `/index.md`, `/zeruxjs.md` and raw Markdown alternatives for every docs route. GitHub Actions verifies their content hashes before publishing, and `verifySites` checks them again in the complete output-branch tree. The workflow deploys the uploaded static artifact directly; it has no Jekyll or Markdown-to-HTML step. Keep `.nojekyll` in the output root if hosting the branch directly. Do not add a subsequent site generator or SPA fallback that rewrites `.md` requests. GitHub Pages controls response MIME headers, so browsers may display or download the raw content.

Palette and motion changes in `scripts/site-design.mjs`, and theme changes in `scripts/site-theme.mjs`, trigger the Pages workflow alongside template/content changes. All of these build from the checkout without publishing workspace packages to npm.
