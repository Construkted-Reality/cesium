# Construkted Reality fork changes

This file lists the changes that the Construkted Reality fork adds to CesiumJS. Upstream
CesiumJS does not contain these changes. See [FORK.md](FORK.md) for the branch layout, the
tag format, and the upgrade procedure.

Do not put these entries in `CHANGES.md`. Upstream owns that file.

Write one section for each `construkted-<upstream>-<n>` tag. Put the newest section first.
Each section starts with the upstream base. A rebase that changes no fork code still gets
a section.

The **Sent upstream** list names the fork changes that wait for a decision from CesiumGS.
The **Removed, now in upstream** list names the fork changes that CesiumGS accepted. Every
entry that moves from the first list to the second makes the fork delta smaller. Read the
two lists together to see whether the fork grows or shrinks.

## Unreleased

Upstream base: commit `488b114e16`, between release 1.145 and release 1.146.

This section gets the tag name `construkted-1.146.0-1` at the next rebase. See
[FORK.md](FORK.md) for the reason.

### Fixes

- Gaussian splat replacements prepare texture data and sort before the old frame finishes.
  They release old textures before the replacement upload to reduce overlapping GPU allocations.

- Gaussian splat loading keeps a root fallback when the cache budget cannot hold it.
  Memory pressure no longer increases detail error without a limit or retains stale decoding work.

- Gaussian splat tiles render without SPZ compression. Mixed tilesets load compressed and
  uncompressed splat attributes through the same rendering path.
- Uncompressed splats retain their higher-order spherical harmonics when a degree-zero
  attribute is present.
- Gaussian splat worker completion and worker initialization request a frame in scenes
  that use `requestRenderMode`. Without this fix an idle scene does not show the splats.
- A camera move that arrives during a sort now starts a second sort. Without this fix the
  splats keep the order of the previous camera position.

- Gaussian splats release the texture worker after the last primitive and pending task finish.
  The worker retains its WebAssembly memory while another splat primitive remains alive.

### Changed files

| File                                                         | Change                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/engine/Source/Scene/GaussianSplat3DTileContent.js` | Load uncompressed attributes. Retain raw harmonics.        |
| `packages/engine/Source/Scene/GaussianSplatPrimitive.js`     | Request a frame after worker events. Finish pending sorts. |
| `packages/engine/Source/Scene/GltfLoader.js`                 | Pass uncompressed splat attributes through.                |

The specs for these fixes are in `packages/engine/Specs/Scene/`.

### Sent upstream

None yet. All four fixes above correct a general defect in CesiumJS, so each one is a
candidate for a pull request to CesiumGS.

### Removed, now in upstream

None yet.

### Tests

- Full spec suite with the WebGL stub: 15807 pass, 0 fail.
- Gaussian splat specs with real WebGL: 45 pass, 0 fail.
- `eslint` on the changed files: clean.
