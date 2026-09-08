import {
  PerspectiveFrustum,
  Math as CesiumMath,
  ResourceCache,
  RequestScheduler,
  HeadingPitchRange,
  GaussianSplat3DTileContent,
  ModelUtility,
  VertexAttributeSemantic,
} from "../../index.js";

import Cesium3DTilesTester from "../../../../Specs/Cesium3DTilesTester.js";
import createScene from "../../../../Specs/createScene.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe(
  "Scene/GaussianSplat3DTileContent",
  function () {
    const tilesetUrl = "./Data/Cesium3DTiles/GaussianSplats/tower/tileset.json";

    for (const testCase of [
      { extensions: [], expected: false },
      { extensions: ["KHR_gaussian_splatting"], expected: true },
      {
        extensions: ["KHR_gaussian_splatting_compression_spz_2"],
        expected: false,
      },
      {
        extensions: [
          "KHR_gaussian_splatting",
          "KHR_gaussian_splatting_compression_spz_2",
        ],
        expected: true,
      },
    ]) {
      it(`detects splat content for ${JSON.stringify(testCase.extensions)}`, function () {
        const tileset = {
          isGltfExtensionRequired(extension) {
            return testCase.extensions.includes(extension);
          },
        };
        expect(
          GaussianSplat3DTileContent.tilesetRequiresGaussianSplattingExt(
            tileset,
          ),
        ).toBe(testCase.expected);
      });
    }

    let scene;
    let options;

    for (const prefix of ["_", "KHR_gaussian_splatting:"]) {
      for (const degree of [0, 1, 2, 3]) {
        for (const includeDc of [false, true]) {
          it(`packs degree ${degree} with prefix ${prefix} and DC ${includeDc}`, function () {
            const attributes = [
              {
                name: "POSITION",
                semantic: VertexAttributeSemantic.POSITION,
                count: 1,
                typedArray: new Float32Array([0, 0, 0]),
              },
              {
                name: `${prefix}ROTATION`,
                semantic: VertexAttributeSemantic.ROTATION,
                typedArray: new Float32Array([0, 0, 0, 1]),
              },
              {
                name: `${prefix}SCALE`,
                semantic: VertexAttributeSemantic.SCALE,
                typedArray: new Float32Array([1, 1, 1]),
              },
            ];
            if (includeDc) {
              attributes.push({
                name: `${prefix}SH_DEGREE_0_COEF_0`,
                typedArray: new Float32Array([8, 8, 8]),
              });
            }
            for (let l = 1; l <= degree; l++) {
              for (let n = 0; n < 2 * l + 1; n++) {
                attributes.push({
                  name: `${prefix}SH_DEGREE_${l}_COEF_${n}`,
                  typedArray: new Float32Array([1, 0.5, 0.25]),
                });
              }
            }
            const loader = {
              components: {
                scene: { nodes: [{ primitives: [{ attributes }] }] },
              },
              destroy() {},
            };
            const content = new GaussianSplat3DTileContent(
              loader,
              { gaussianSplatPrimitive: {} },
              {},
              {},
            );
            content._resourcesLoaded = true;
            try {
              content.update(undefined, { afterRender: [] });
              const count = (degree + 1) ** 2 - 1;
              expect(content.sphericalHarmonicsDegree).toBe(degree);
              expect(content.sphericalHarmonicsCoefficientCount).toBe(
                count * 3,
              );
              const expected = [];
              for (let i = 0; i < count; i++) {
                // IEEE half encodings: 1 = 0x3c00, 0.5 = 0x3800, 0.25 = 0x3400.
                expected.push(0x38003c00, 0x3400);
              }
              expect(Array.from(content.packedSphericalHarmonicsData)).toEqual(
                expected,
              );
            } finally {
              content.destroy();
            }
          });
        }
      }
    }

    beforeAll(function () {
      scene = createScene();
    });

    afterAll(function () {
      scene.destroyForSpecs();
    });

    beforeEach(function () {
      RequestScheduler.clearForSpecs();
      scene.morphTo3D(0.0);

      const camera = scene.camera;
      camera.frustum = new PerspectiveFrustum();
      camera.frustum.aspectRatio =
        scene.drawingBufferWidth / scene.drawingBufferHeight;
      camera.frustum.fov = CesiumMath.toRadians(60.0);

      options = {
        cullRequestsWhileMoving: false,
        maximumScreenSpaceError: 1,
      };
    });

    afterEach(function () {
      scene.primitives.removeAll();
      ResourceCache.clearForSpecs();
    });

    it("loads Gaussian Splat content", function () {
      return Cesium3DTilesTester.loadTileset(scene, tilesetUrl, options).then(
        function (tileset) {
          scene.camera.lookAt(
            tileset.boundingSphere.center,
            new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
          );

          return Cesium3DTilesTester.waitForTileContentReady(
            scene,
            tileset.root,
          ).then(function (tile) {
            const content = tile.content;
            expect(content).toBeDefined();
            expect(content instanceof GaussianSplat3DTileContent).toBe(true);

            const gltfPrimitive = content.gltfPrimitive;
            expect(gltfPrimitive).toBeDefined();
            expect(gltfPrimitive.attributes.length).toBeGreaterThan(0);
            const positions = ModelUtility.getAttributeBySemantic(
              gltfPrimitive,
              VertexAttributeSemantic.POSITION,
            ).typedArray;

            const rotations = ModelUtility.getAttributeBySemantic(
              gltfPrimitive,
              VertexAttributeSemantic.ROTATION,
            ).typedArray;

            const scales = ModelUtility.getAttributeBySemantic(
              gltfPrimitive,
              VertexAttributeSemantic.SCALE,
            ).typedArray;

            const colors = ModelUtility.getAttributeBySemantic(
              gltfPrimitive,
              VertexAttributeSemantic.COLOR,
            ).typedArray;

            expect(positions.length).toBeGreaterThan(0);
            expect(rotations.length).toBeGreaterThan(0);
            expect(scales.length).toBeGreaterThan(0);
            expect(colors.length).toBeGreaterThan(0);
          });
        },
      );
    });

    it("Create and destroy GaussianSplat3DTileContent", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );

      scene.primitives.remove(tileset);
      expect(tileset.isDestroyed()).toBe(true);
      expect(tile.isDestroyed()).toBe(true);
      expect(tile.content).toBeUndefined();
    });

    it("Load multiple instances of Gaussian splat tileset and validate transformed attributes", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );

      const tileset2 = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );

      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );

      scene.camera.lookAt(
        tileset2.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset2.boundingSphere.radius),
      );

      const tile2 = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset2.root,
      );
      const content = tile.content;
      const content2 = tile2.content;

      expect(content).toBeDefined();
      expect(content instanceof GaussianSplat3DTileContent).toBe(true);
      expect(content2).toBeDefined();
      expect(content2 instanceof GaussianSplat3DTileContent).toBe(true);

      await pollToPromise(function () {
        scene.renderForSpecs();
        return (
          tile.content._transformed === true &&
          tile2.content._transformed === true
        );
      });

      const positions1 = tile.content._positions;
      const positions2 = tile2.content._positions;

      expect(positions1.every((p, i) => p === positions2[i])).toBe(true);

      const rotations1 = tile.content._rotations;
      const rotations2 = tile2.content._rotations;

      expect(rotations1.every((r, i) => r === rotations2[i])).toBe(true);

      const scales1 = tile.content._scales;
      const scales2 = tile2.content._scales;

      expect(scales1.every((s, i) => s === scales2[i])).toBe(true);
    });

    it("keeps transformed attribute buffers separate from the original glTF attributes", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );
      const content = tile.content;

      const sourcePositions = ModelUtility.getAttributeBySemantic(
        content.gltfPrimitive,
        VertexAttributeSemantic.POSITION,
      ).typedArray;
      const sourceRotations = ModelUtility.getAttributeBySemantic(
        content.gltfPrimitive,
        VertexAttributeSemantic.ROTATION,
      ).typedArray;
      const sourceScales = ModelUtility.getAttributeBySemantic(
        content.gltfPrimitive,
        VertexAttributeSemantic.SCALE,
      ).typedArray;

      expect(content.positions).not.toBe(sourcePositions);
      expect(content.rotations).not.toBe(sourceRotations);
      expect(content.scales).not.toBe(sourceScales);

      const originalPosition = sourcePositions[0];
      const originalRotation = sourceRotations[0];
      const originalScale = sourceScales[0];

      content.positions[0] = originalPosition + 1.0;
      content.rotations[0] = originalRotation + 0.25;
      content.scales[0] = originalScale + 2.0;

      expect(sourcePositions[0]).toBe(originalPosition);
      expect(sourceRotations[0]).toBe(originalRotation);
      expect(sourceScales[0]).toBe(originalScale);
    });

    it("geometryByteLength returns 0 and is never NaN", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );
      const content = tile.content;

      expect(content.geometryByteLength).toBe(0);
      expect(isNaN(content.geometryByteLength)).toBe(false);
    });

    it("texturesByteLength returns 0 when gaussianSplatPrimitive is undefined", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );
      const content = tile.content;

      // Simulate the primitive not yet being initialized or already being destroyed
      const savedPrimitive = tileset.gaussianSplatPrimitive;
      tileset.gaussianSplatPrimitive = undefined;

      expect(content.texturesByteLength).toBe(0);

      // Restore so afterEach cleanup works correctly
      tileset.gaussianSplatPrimitive = savedPrimitive;
    });

    it("destroying a tile content does not destroy the shared gaussianSplatPrimitive", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        tilesetUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );
      const content = tile.content;
      const gaussianSplatPrimitive = tileset.gaussianSplatPrimitive;

      expect(gaussianSplatPrimitive).toBeDefined();
      expect(gaussianSplatPrimitive.isDestroyed()).toBe(false);

      // Simulate LRU cache tile eviction: destroy just this tile content.
      content.destroy();
      tile._content = undefined;

      // The shared gaussianSplatPrimitive must still be alive after a single
      // tile content is destroyed, because other tiles in the tileset still
      // rely on it.
      expect(gaussianSplatPrimitive.isDestroyed()).toBe(false);
    });
  },
  "WebGL",
);
