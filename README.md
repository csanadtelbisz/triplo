# Triplo

Trip logger application that supports combining multi-modal travel routes in a trip.

On mobile (up to 768px wide), hold two fingers still on the map for 250ms to
measure the straight-line distance between them. The measurement remains for five
seconds after both fingers lift, or until another map interaction starts.
Moving either finger or pinching hides it immediately. Pinch zoom continues to
work normally.

## Development checks

In `frontend`, run `npm ci`, `npx playwright install chromium`, `npm test`, and
`npm run build`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a system Chromium.
The browser tests use a local, real MapLibre map without external tile services.

## Pull request deployments

The **Pull request preview** workflow validates pull requests and deploys previews
for branches in this repository to
`https://csanadtelbisz.github.io/triplo/pr-preview/pr-<number>/`.
Deployment links appear in the deployment job's summary. Fork PRs run validation
only, without deployment permissions or secrets.

GitHub Pages hosts one site per repository, so both deployment workflows publish
the default branch at `/triplo/` together with all open same-repository PRs under
`pr-preview/`. Closing a PR removes its preview on the next successful deployment.
Production and preview publishing share the `pages` concurrency group. Preview
deployments use the `pull-request-previews` environment; production uses the
existing `github-pages` environment. Repository Pages settings stay on **GitHub
Actions**. No additional hosting account or deployment secret is needed.

Google OAuth configuration secrets are included only in the production build.
Previews can be explored without setup or with GitHub storage; Google Drive
authentication is unavailable in preview builds. All previews are rebuilt from
their current head commit on each deployment.
