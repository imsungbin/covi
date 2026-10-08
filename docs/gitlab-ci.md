# GitLab CI

This page covers reviewing merge requests with the CI template in `integrations/gitlab-ci/covi.yml`. It explains setup, the template's inputs, how the job installs Covi, what the job produces, the token for merge request notes, how forks and protected variables affect a run, and how Covi learns from outcomes.

The template defines one job, `covi-review`, which runs [`covi ci --platform gitlab`](cli.md) in merge request pipelines. Its first document is a `spec:inputs` header, so your GitLab version must support CI/CD inputs. The job's scripts use bash.

## Quick start

1. **Make Covi available on your instance.** Host the Covi repository in a project on your GitLab instance, for example `your-org/covi`, and tag a release, for example `v1`. If that project is private, let your project's job token read it: in the Covi project, **Settings > CI/CD > Job token permissions**, add your project.
2. **Include the template** from your project's `.gitlab-ci.yml`, as in [`examples/gitlab-ci.yml`](../integrations/gitlab-ci/examples/gitlab-ci.yml):

   ```yaml
   stages: [test]

   include:
     - project: 'your-org/covi'        # replace with where Covi lives on your GitLab instance
       ref: v1
       file: '/integrations/gitlab-ci/covi.yml'
       inputs:
         covi-project: your-org/covi   # the same project, cloned by the job to install Covi
         covi-ref: v1                  # the same ref as above
         fail-on: high                 # fail on confirmed/likely high-severity findings
         video-mode: short
         duration: 30s
   ```

   `your-org/covi` is a placeholder. The `project` you include from and the `covi-project` the job installs from are the same project; keep `ref` and `covi-ref` equal too.

3. **Add CI/CD variables** under **Settings > CI/CD > Variables**. Both are optional:
   - `COVI_GITLAB_TOKEN`: a project access token with the `api` scope, for the merge request note. Without it, Covi still reviews and uploads its reports and artifacts; it only skips the note.
   - `ANTHROPIC_API_KEY`: enables model-written explanations and findings.

You don't need any Covi configuration to start. To tune it, add `.covi/config.yml` to your default branch (see [configuration.md](configuration.md)). In CI, Covi reads it from the merge request's base revision.

## Inputs

Inputs that mirror a Covi setting default to empty. Empty means the setting comes from `.covi/config.yml` on the base revision, and then from Covi's own default, shown in the table. Set an input only to override the repository. GitLab substitutes inputs as text, so the template quotes every one it uses; an empty input stays an empty string.

| Input | Default | Description |
|---|---|---|
| `stage` | `test` | Pipeline stage for the `covi-review` job. |
| `image` | `mcr.microsoft.com/playwright:v1.63.0-noble` | Image with Node.js 22.18+, bash, and Chromium. Keep its version equal to Covi's Playwright version (see [Installing Covi](#installing-covi)). |
| `covi-project` | `your-org/covi` | Project on this GitLab instance that holds Covi, normally the one you include the template from. The job clones it with the job token. |
| `covi-ref` | `main` | Branch or tag of Covi to install. Pin it to the ref you include. |
| `covi-package` | empty | Install Covi from this npm package spec or tarball URL instead of from `covi-project`. Use a package you publish and control. |
| `fail-on` | empty (`review.failOn`, else `none`) | Fail the job on confirmed or likely findings at or above this severity: `none`, `low`, `medium`, or `high`. |
| `video` | empty (`video.when`, else `auto`) | Render a review video only when the change is worth seeing (`auto`), `always`, or `never`. |
| `video-mode` | empty (`video.mode`, else `short`) | `short` (9:16, about 30 s), `standard` (16:9, up to 120 s), or `custom`. Passed as `--mode`. |
| `duration` | empty (`video.duration`, else `auto`) | Target video length, for example `30s`, or `auto`. |
| `narration` | empty (`video.narration`, else on) | `true` or `false`. |
| `language` | empty (`language`, else `auto`) | The language of the review, the note, and the video: `auto` (detected from the merge request), `en`, `ko`, `ja`, or `zh`. Passed as `--language`. |
| `comment` | empty (`publish.comment`, else on) | `true` or `false`: post or update a merge request note. Posting needs `COVI_GITLAB_TOKEN`. |
| `provider` | empty (`intelligence.provider`, else `auto`) | Reasoning provider: `auto`, `heuristic`, `anthropic`, or `command`. `auto` uses `ANTHROPIC_API_KEY` when it's set. |
| `expire-in` | `2 weeks` | How long to keep the run artifacts. |

`covi ci` validates the values; an invalid one stops the job with exit code 2.

### Installing Covi

By default, the job installs Covi from its own source on your instance:

1. It fetches `covi-ref` of `covi-project` into `/opt/covi` with the job's token, from a URL built from GitLab's own variables: `$CI_SERVER_PROTOCOL://gitlab-ci-token:$CI_JOB_TOKEN@$CI_SERVER_HOST:$CI_SERVER_PORT/<covi-project>.git`.
2. It runs `npm ci` there, which also builds the bundled CLI.
3. It runs `/opt/covi/bin/covi.mjs` with `COVI_USE_DIST=1`.

So the job runs exactly the Covi at the ref you pinned. If `covi-project` is private, add your project to its **Job token permissions** allowlist (**Settings > CI/CD**), so the job token can read it.

To install from a package instead, set `covi-package` to an npm spec or tarball URL that you publish and control; the job then runs `npm install --global "$COVI_PACKAGE"`. Don't use the bare name `covi`: on the public npm registry it belongs to an unrelated project.

Next, the job runs `covi doctor --install-browser`. That installs the Chromium build Covi's own Playwright version expects, and is a quick no-op when the image already has it. Covi pins Playwright exactly, and the default `image` is the Playwright image of that same version (a test keeps the two equal), so the browser is normally already there. If you change `image`, prefer a Playwright image with the same version.

## What the job does

The job runs only when `$CI_PIPELINE_SOURCE == "merge_request_event"`.

1. **Clone the full history.** `GIT_DEPTH: "0"` gives Covi the merge base without fetching. Covi can fetch missing commits itself, but a full clone avoids it.
2. **Install missing tools** with `apt-get`: git when it's missing, and ffmpeg and espeak-ng when they're missing and the `video` input isn't `never`.
3. **Install Covi** as described in [Installing Covi](#installing-covi), then the browser.
4. **Run the review:** `covi ci --platform gitlab --out "$CI_PROJECT_DIR/.covi-run"`, plus one flag for each input you set:

   | Input | Flag |
   |---|---|
   | `fail-on` | `--fail-on <value>` |
   | `video` | `--video <value>` |
   | `video-mode` | `--mode <value>` |
   | `duration` | `--duration <value>` |
   | `narration` | `--narration` or `--no-narration` |
   | `comment` | `--comment` or `--no-comment` |
   | `provider` | `--provider <value>` |

   The script builds the arguments as a bash array and quotes every value.

`covi ci` reads the change from GitLab's predefined variables:

- **Base:** `CI_MERGE_REQUEST_DIFF_BASE_SHA`.
- **Head:** `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`. Merged results pipelines check out a merge commit, so this is the real head. Covi falls back to `CI_COMMIT_SHA` when the variable is empty.
- **Context:** the merge request's title, description, and branches go into the analysis.

When seeing the change helps and Covi can run the project, it demonstrates the change whether or not a video is made: it captures pages (at desktop and mobile sizes unless `demo.viewports` says otherwise), API responses, or command output at the base and head revisions, and observed regressions become confirmed findings. How Covi runs the project comes from `.covi/config.yml` on the base revision. Those commands run without `covi trust`, because the base revision's configuration comes from your maintainers; trust is for configuration in a working tree on your own machine (see [security.md](security.md#commands-in-repository-configuration-need-your-trust)).

## What it produces

### Artifacts

The job uploads `.covi-run/` with `when: always`, so artifacts exist even when the review gate fails the job. They expire after `expire-in`. The directory is exposed in the merge request as **Covi review** (`artifacts:expose_as`). It holds:

- `review.md`, `explanation.md`, and `summary.md`
- the `run.json` manifest
- the reports
- demo screenshots, when the software was demonstrated
- the video, poster, and captions, when a video was made

See [artifacts.md](artifacts.md).

### Code Quality report

`.covi-run/reports/gl-code-quality-report.json` is attached as a `codequality` report, so findings show up in the merge request's Code Quality widget. Each finding becomes one entry, with its location, its category, and a stable fingerprint. Severities map like this:

| Covi finding | Code Quality severity |
|---|---|
| High severity, confirmed or likely | `critical` |
| High severity, `risk` | `major` |
| Medium severity | `major` |
| Low severity | `minor` |
| Any `question` | `info` |

The Code Quality widget is GitLab's form of inline annotations, so `--no-annotations` (or `publish.annotations: false` in the configuration) writes the report empty (`[]`). The file still exists, so the job's `artifacts:reports` entry stays valid.

### dotenv variables

`.covi-run/reports/covi.env` is attached as a `dotenv` report. Jobs that depend on `covi-review` receive these variables:

| Variable | Value |
|---|---|
| `COVI_VERDICT` | `looks-good`, `needs-attention`, or `needs-changes` |
| `COVI_FINDINGS` | Number of findings |
| `COVI_RUN_DIR` | The run directory (`$CI_PROJECT_DIR/.covi-run`) |
| `COVI_VIDEO` | Path of the video, only when one was made |

```yaml
covi-verdict:
  stage: test
  needs: [covi-review]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - echo "Covi says $COVI_VERDICT ($COVI_FINDINGS findings)"
```

The run also writes `reports/covi.sarif` (SARIF 2.1.0), which is kept with the artifacts.

### The merge request note

With a token, and unless `comment` (or `publish.comment`) turns it off, Covi keeps one note per merge request. It finds its earlier note by a hidden marker, `<!-- covi:review -->`, and edits that note on every pipeline instead of adding new ones. Anyone can paste the marker, so only a note the token's own user wrote counts (Covi asks GitLab who that is). If Covi cannot read the notes, it posts nothing rather than overwrite what it could not read.

The note is rebuilt from the run's schema-validated `review.json` and `explanation.json`, with all dynamic text escaped. It contains:

- the verdict, headline, and summary
- the video, when one was made
- a findings table with certainty, severity, and location
- collapsible details with evidence and suggestions
- what changed and what was not verified
- links to the job artifacts and the pipeline
- a last line, *Was this useful? 👍 👎*, whose award emoji `covi outcomes` counts (`publish.rating: false` leaves it out)

The note also ends with a hidden ledger, `<!-- covi:ledger v1 … -->`: which findings Covi reported on each pipeline, as hashes and certainties with no text. See [Learning from outcomes](#learning-from-outcomes).

Each finding in the note lists the evidence it cites; captures (screenshots, recordings, traces) link to the file in the job's artifacts.

How the video appears depends on `publish.video` in `.covi/config.yml`:

- `link` (default): a link to the video inside the job's artifacts (`<job URL>/artifacts/file/.covi-run/video/covi-review.mp4`). The link works once the job has finished uploading artifacts.
- `upload`: Covi uploads the video with the project uploads API and embeds it, so it plays inline in the note.
- `none`: no video in the note.

## The review gate

`fail-on` sets the threshold. Only `confirmed` and `likely` findings can fail the gate. With no `fail-on` input and no `review.failOn` in the configuration, the threshold is `none`, which never fails.

When the gate fails, `covi ci` posts the note, writes the reports, and exits with code 1, so the job fails. Artifacts are still uploaded. Other exit codes mean a problem with Covi itself:

- `2`: usage or invalid input
- `3`: environment
- `4`: internal error

To make the gate advisory while keeping the threshold visible in the job status, allow exit code 1 in your project's `.gitlab-ci.yml`:

```yaml
covi-review:
  allow_failure:
    exit_codes: [1]
```

## The token for notes

Covi reads the token from `COVI_GITLAB_TOKEN`, then from `GITLAB_TOKEN`, and sends it in the `PRIVATE-TOKEN` header. It uses the token only for these requests:

- ask GitLab whose token it is (`GET /user`), so Covi edits only its own note
- list the merge request's notes
- create or update its own note
- upload the video, when `publish.video` is `upload`

The token needs:

- **Type:** a project access token. A personal or group access token also works, but has a wider reach than needed.
- **Scope:** `api`.
- **Role:** one that can comment on merge requests, Reporter or higher.
- **Expiry:** set one.

Notes don't use `CI_JOB_TOKEN`, because a job token can't write them; the template uses the job token only to fetch Covi's source. If GitLab rejects the token, the job log says so, and the review continues without the note.

### Masked and protected variables

- **Masked:** store the token, and any API keys, as masked variables, so they don't appear in job logs. Covi also redacts token-shaped strings and the values of credential-named environment variables from everything it writes (see [security.md](security.md)).
- **Protected:** a protected variable is only exposed to pipelines that run on protected refs. Leave `COVI_GITLAB_TOKEN` unprotected: most merge request pipelines run on unprotected branches, and without the token Covi reviews them without posting a note. The token that collects outcomes is a different matter: it goes in its own protected variable, `GITLAB_TOKEN` (see [Learning from outcomes](#learning-from-outcomes)).

## Merge requests from forks

Covi treats a merge request whose source project differs from its target project as untrusted. It reviews the change and writes all reports and artifacts, but doesn't post a note. The job log gives this reason:

```
merge request from a fork: its pipeline should not hold a token that can write to this project; see docs/gitlab-ci.md
```

By default, GitLab runs pipelines for fork merge requests in the fork's project, with the fork's CI/CD variables, not yours. A maintainer can instead run the pipeline in the parent project. GitLab then runs the fork's pipeline definition with the parent project's variables, and asks for confirmation for that reason.

Covi's own safeguards still apply in that case:

- configuration is read from the base revision
- project commands get an allowlisted environment
- no note is posted for a fork

But no tool can constrain a pipeline definition supplied by the fork. Review a fork's changes before running its pipeline in your project.

## Learning from outcomes

GitLab runs no pipeline when a merge request closes, so outcomes are collected on a schedule. Include the outcomes component next to the review:

```yaml
include:
  - project: 'your-org/covi'
    ref: v1
    file: '/integrations/gitlab-ci/covi.yml'
    inputs: { covi-project: your-org/covi, covi-ref: v1 }
  - project: 'your-org/covi'
    ref: v1
    file: '/integrations/gitlab-ci/covi-outcomes.yml'
    inputs: { covi-project: your-org/covi, covi-ref: v1, recent: '50' }
```

Then:

1. **Add a token for collecting.** A project access token with the `read_api` scope, stored as the CI/CD variable `GITLAB_TOKEN`, masked and protected. `CI_JOB_TOKEN` cannot read notes or award emoji. The job ignores `COVI_GITLAB_TOKEN`, which keeps its role for the review's note. Notes count as Covi's when `GITLAB_TOKEN`'s user wrote them, so the simplest setup stores the same token value in both variables. To collect with a different token, set `publish.gitlabBotUser` in `.covi/config.yml` on the default branch to the username of the token that posts the notes; Covi then counts that user's notes too, once GitLab confirms the account is a bot.
2. **Add a pipeline schedule** on the default branch (**Build > Pipeline schedules**; daily is plenty). The job also runs when you start a pipeline on the default branch by hand.

The `covi-outcomes` job runs only on the protected default branch. It runs `covi outcomes collect --platform gitlab --recent <n>` and then `covi outcomes report`, and keeps `.covi/outcomes/` in the CI cache `covi-outcomes`. A merge request pipeline on a protected branch pulls that cache, so the brief of its review shows how past findings held up.

The job collects, for each recently closed merge request Covi commented on:

- the merge request's state: merged, or closed without merging;
- reverts since the merge, from git's "This reverts commit …" or GitLab's "This reverts merge request !n";
- 👍 and 👎 award emoji on Covi's note, without the merge request author's own;
- replies in the note's thread;
- findings that disappeared after a push, from the note's hidden ledger.

[Learning from outcomes](github-action.md#learning-from-outcomes) in the GitHub guide explains how that becomes precision by certainty. Per-finding anchors (inline comments to vote on) are GitHub-only for now, so on GitLab a finding is labeled by what happened to it, not by votes.

What reviews trust, and what that costs:

- **Only protected refs read outcomes.** GitLab keeps a protected and an unprotected cache for each key. Only the protected one is trusted: the schedule writes it, and reviews on protected refs pull it. Merge requests from unprotected branches (most of them) review without calibration, and before Covi runs, their job deletes any restored `.covi/outcomes/` and resets the checkout, so no cache can shape what is reviewed.
- **Keep "Use separate caches for protected branches" on** (**Settings > CI/CD > General pipelines**; GitLab's default). Turned off, every branch's pipeline shares one cache, and any developer could write what reviews trust.
- **Only Covi's own notes count.** A pasted marker never does, and a merge request where Covi did not comment is skipped.
- **The data is validated and bounded,** and a review only reads it.

## Customizing the job

GitLab merges keys you define for `covi-review` in your own `.gitlab-ci.yml` into the included job. Use that to add `tags`, `timeout`, `allow_failure`, extra `rules`, or `variables`.

These variables also configure Covi, beyond the template's inputs:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Model-written explanations and findings (`provider: auto` or `anthropic`). |
| `COVI_MODEL` | Model id for the `anthropic` provider. |
| `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` | Narration with hosted voices. ElevenLabs is preferred when both are set; without either, Covi uses espeak-ng. |
| `COVI_TTS_PROVIDER`, `COVI_TTS_VOICE` | Speech engine (`auto`, `system`, `openai`, `elevenlabs`, `none`) and voice. |
| `COVI_CAPTIONS` | `false` to render without burned-in captions. |

Everything else comes from `.covi/config.yml` on the base revision. That includes video size for `video-mode: custom`, the `publish.video` mode, and the commands used to run your app for demonstrations. See [configuration.md](configuration.md).

Using a different image:

- It needs Node.js 22.18 or later, bash, and a Chromium that Covi's Playwright can launch. `covi doctor --install-browser --with-deps` installs both the browser and its system libraries.
- Covi needs git; the template installs it with `apt-get` when it's missing.
- Rendering videos needs ffmpeg, and system narration needs espeak-ng. The template installs them with `apt-get`, so on images without apt, provide them in the image itself.

## How the template is tested

`tests/integrations.test.ts` checks the template: every input has a default and is used, every option list contains its default, the job runs on merge request pipelines with full history, the flags it passes are flags `covi ci` and `covi doctor` accept, rendering the template with its default inputs yields strings and never nulls, Covi is installed from source or a package you name, and the default image matches the pinned Playwright version. `tests/ci.test.ts` runs `covi ci` with GitLab's variables against a local stand-in for the GitLab API, including the note, the Code Quality and dotenv reports, and `--no-annotations`. The template and the example were also checked against GitLab's published CI/CD JSON schema. The outcomes component is checked too: it runs only on a schedule or a manual pipeline on the protected default branch, collects with `GITLAB_TOKEN` alone, and the review restores its cache only on a protected ref.

The job's scripts have also been run unchanged inside the default image against an example merge request, with git redirecting the job-token clone URL to a local copy of Covi. That exercised installing the missing tools, installing Covi from source, the browser check, the review, a narrated video, and both reports. It is not a run on a GitLab instance.
