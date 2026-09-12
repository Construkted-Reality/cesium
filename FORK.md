# Construkted Reality fork of CesiumJS

Read this file before you change anything in this repository.

This repository is a fork of [CesiumGS/cesium](https://github.com/CesiumGS/cesium). It
carries a small set of Construkted Reality corrections on top of an upstream CesiumJS
release. The fork follows upstream. Upstream does not follow the fork.

The design goal is that the fork delta stays small, readable, and easy to move to the
next upstream release.

## Remotes

Configure both remotes before you start work.

| Remote     | URL                                                 | Use                    |
| ---------- | --------------------------------------------------- | ---------------------- |
| `upstream` | `https://github.com/CesiumGS/cesium.git`            | Read only. Never push. |
| `origin`   | `https://github.com/Construkted-Reality/cesium.git` | The fork. Push here.   |

To set them up, run these commands:

```sh
git remote add upstream https://github.com/CesiumGS/cesium.git
git remote add origin https://github.com/Construkted-Reality/cesium.git
git fetch upstream --tags
```

## Branches

| Branch             | Base                    | Content                                                  | Rebased each month |
| ------------------ | ----------------------- | -------------------------------------------------------- | ------------------ |
| `main`             | An upstream release tag | The upstream release and the fork commits. Nothing else. | Yes                |
| `feature/<topic>`  | `main`                  | Work in progress on one topic.                           | Yes                |
| `research/<topic>` | Any commit              | Measurements, harness code, notes, result data.          | No                 |

Rules for branches:

- Commit fork work to a `feature/<topic>` branch. Do not commit to `main` directly.
- Base a new `feature` branch on `main`, not on `upstream/main`.
- Merge a `feature` branch into `main` only after the tests pass.
- Keep research data out of `main`. Put it on a `research/<topic>` branch.

## Version and tags

The fork has no version number of its own in any `package.json` file. The git tag is the
fork version.

**CAUTION:** Do not change the `version` field in `package.json`,
`packages/engine/package.json`, `packages/widgets/package.json`, or
`packages/sandcastle/package.json`. Three problems follow if you do:

1. Upstream changes all four fields at each release. Each field then conflicts each month,
   and the conflict carries no information.
2. A prerelease suffix such as `-cr.1` does not satisfy the `^26.3.0` range that the root
   `package.json` uses for `@cesium/engine`. The workspace stops resolving.
3. `gulpfile.js` compiles the root version into the bundle as `CESIUM_VERSION`.
   `IonResource.js` sends that string to Cesium ion in the `X-Cesium-Client-Version`
   header. `ITwinPlatform.js` sends it to iTwin as `clientVersion`. A private version
   string then goes to a third party.

### Tag format

| Tag                          | Example                        | Meaning                                                    |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `construkted-<upstream>-<n>` | `construkted-1.145.0-1`        | A release of the fork. Consumers pin this tag.             |
| `archive/<date>/<branch>`    | `archive/2026-09-08/main`      | The state of a branch before a rebase. Never delete these. |
| `<topic>-benchmarks-<date>`  | `memory-benchmarks-2026-09-07` | A measurement result. Not a release.                       |

The `<upstream>` part is the full upstream release version that `main` sits on. The `<n>`
part is an integer. It starts at 1 for each new upstream release. It increases by 1 for
each later release of the fork on the same upstream base.

The tag answers two questions. `1.145.0` says which CesiumJS this is. `-1` says which
build of the fork changes it is. The upstream part always increases first, so the tags
sort in release order.

### Tag rules

1. Cut a tag each time `main` changes in a way that reaches a consumer.
2. Never move a tag after you push it. Cut a new tag instead.
3. Use `git tag -a`. Put the upstream base and the test result in the message.
4. Pin the tag in each consumer project.

To list the releases in order, run this command:

```sh
git tag -l 'construkted*' --sort=v:refname
```

A plain alphabetical sort puts `-10` before `-2`. Always use `--sort=v:refname`.

An install from a git URL writes the resolved commit hash into the consumer lockfile. That
hash identifies the exact build. Therefore the fork does not need a version constant in
the source.

## Where to commit fork work

Put new code in a new file when you can. A new file never conflicts with upstream.
An edit inside an upstream file conflicts every time upstream touches that file.

Reduce each edit inside an upstream file to the smallest possible change. A call site is
better than a rewritten function.

Never edit these upstream-owned files:

| Upstream file | Use this fork file instead |
| ------------- | -------------------------- |
| `CHANGES.md`  | `CHANGES-construkted.md`   |
| `README.md`   | `FORK.md`                  |

Upstream rewrites the top of `CHANGES.md` at every release. An entry there conflicts
every month and the conflict carries no information.

## Monthly upgrade to a new upstream release

CesiumGS publishes a release on the first day of each month. Rebase onto the release
tag. Do not rebase onto `upstream/main`, because `upstream/main` is unstable between
releases.

The procedure below moves the fork from release `<old>` to release `<new>`.

1. Run `git fetch upstream --tags`.
2. Run `git checkout main`.
3. Run `git tag archive/$(date +%F)/main main`. This makes the current state permanent.
4. Run `git rebase --onto <new> <old> main`.
5. Resolve each conflict. Work through one commit at a time.
6. Run `npm install`. This repository does not commit a lockfile.
7. Run `npm run eslint`.
8. Run `npm run test-non-webgl`.
9. Run `npm run test-webgl`. This step needs a graphics processor.
10. Add a section to `CHANGES-construkted.md` for the new tag.
11. Run `git tag -a construkted-<new>-1`. Give the upstream base and the test result.
12. Run `git push --force-with-lease origin main`.
13. Run `git push origin --tags`.

**CAUTION:** Step 12 rewrites the history of `main`. Tell each consumer before you push.
A consumer that pinned a `construkted-<upstream>-<n>` tag is safe, because the tag does
not move.

If a rebase goes wrong, run `git rebase --abort`. If you already finished a bad rebase,
run `git reset --hard archive/<date>/main`.

## What keeps the monthly cost low

- Send each general bug fix to upstream as a pull request. Upstream accepts the fix, and
  then the fork does not carry it any more. This is the largest saving available.
- Write one topic in each commit. A conflict in a single-topic commit is easy to
  understand. A conflict in a mixed commit is not.
- Use a conventional commit message: `<type>(<scope>): <subject>`.
- Add a spec for each fix. The specs prove that a rebase did not break the fix.

## Verification

The fork delta is the output of this command:

```sh
git log --oneline <upstream tag>..main
```

Read that list before and after a rebase. The two lists must show the same topics.

To see the changed files, run this command:

```sh
git diff --stat <upstream tag> main
```

## Current state

`main` is not on an upstream release tag yet. It sits on upstream commit `488b114e16`,
which is 16 commits after release `1.145` and before release `1.146`.

Therefore no `construkted-` tag exists yet. The first one is `construkted-1.146.0-1`. Cut
it at the next rebase, when `main` first sits on a release tag. The rules in
[Version and tags](#version-and-tags) apply from that point.

The fork changes 6 files in `packages/engine`. All of the changes are in the Gaussian
splat renderer. `CHANGES-construkted.md` lists them.

## Local setup problems

`npm install` runs a postinstall step that calls `playwright install --with-deps`. That
step needs root rights. On a machine without root rights the step fails and stops the
install.

The dependencies are correct after the failure, but the build did not run. Do these steps:

1. Run `npm install --ignore-scripts`.
2. Run `npx gulp build`. This step writes `packages/engine/index.js` and
   `packages/widgets/index.js`. The specs do not build without these two files.

Karma needs a browser. If the machine has no Chrome, set `CHROME_BIN` to a Playwright
browser:

```sh
export CHROME_BIN=~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
npx gulp test --browsers ChromeHeadless --includeName GaussianSplat
```

## Consumer policy

A consumer project must pin a reviewed commit or a `construkted-<version>` tag from this
repository. The public `cesium` package on npm does not contain these corrections.
