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

| Branch             | Base                    | Content                                                | Rebased each month                       |
| ------------------ | ----------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `construkted`      | An upstream release tag | The trunk. All fork work goes here.                    | Yes                                      |
| `main`             | `construkted`           | The last released state. Consumers pin a tag cut here. | No. It moves forward from `construkted`. |
| `feature/<topic>`  | `construkted`           | Work in progress on one topic.                         | Yes                                      |
| `research/<topic>` | Any commit              | Measurements, harness code, notes, result data.        | No                                       |

`construkted` is the trunk. `main` is not. `main` holds the last package that passed the
tests, and it moves forward only at release time.

Both branches hold a complete copy of CesiumJS with the fork changes applied. They are not
a base and a patch. `main` simply lags behind `construkted`.

Rules for branches:

- Commit fork work to a `feature/<topic>` branch. Do not commit to `construkted` directly.
- Base a new `feature` branch on `construkted`, not on `main` and not on `upstream/main`.
- Merge a `feature` branch into `construkted` with a pull request, after the tests pass.
- Never commit to `main`. `main` only fast-forwards from `construkted` at release time.
- Keep research data out of `construkted`. Put it on a `research/<topic>` branch.

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

You rebase `construkted` only. `main` then fast-forwards to it. This gives one rebase each
month, not two.

1. Run `git fetch upstream --tags`.
2. Run `git checkout construkted`.
3. Run `git tag archive/$(date +%F)/construkted construkted`. This makes the current state
   permanent.
4. Run `git rebase --onto <new> <old> construkted`.
5. Resolve each conflict. Work through one commit at a time.
6. Run `npm install`. This repository does not commit a lockfile.
7. Run `npm run eslint`.
8. Run `npm run test-non-webgl`.
9. Run `npm run test-webgl`. This step needs a graphics processor.
10. Add a section to `CHANGES-construkted.md` for the new tag.
11. Run `git push --force-with-lease origin construkted`.

Do the steps below when the package passes review and you want to release it.

1. Run `git checkout main`.
2. Run `git merge --ff-only construkted`. If this command fails, `main` holds a commit that
   `construkted` does not. Find that commit before you continue.
3. Run `git tag -a construkted-<new>-1`. Give the upstream base and the test result.
4. Run `git push origin main`.
5. Run `git push origin construkted-<new>-1`.

After the release, `main` and `construkted` point at the same commit. Later work moves
`construkted` ahead again.

**CAUTION:** Step 11 of the first list rewrites the history of `construkted`. Tell each
person who works on a `feature` branch before you push. Each open `feature` branch needs a
rebase onto the new `construkted`.

A consumer that pinned a `construkted-<upstream>-<n>` tag is safe, because the tag does
not move.

If a rebase goes wrong, run `git rebase --abort`. If you already finished a bad rebase,
run `git reset --hard archive/<date>/construkted`.

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
git log --oneline <upstream tag>..construkted
```

Read that list before and after a rebase. The two lists must show the same topics.

To see the changed files, run this command:

```sh
git diff --stat <upstream tag> construkted
```

## Current state

`construkted` is not on an upstream release tag yet. Neither is `main`. Both sit on an
upstream commit between release `1.145` and release `1.146`.

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
