import {
  Cartesian3,
  Cesium3DTileset,
  HeadingPitchRange,
  Matrix4,
  ResourceCache,
} from "../../index.js";
import createCanvas from "../../../../Specs/createCanvas.js";
import createScene from "../../../../Specs/createScene.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe(
  "Scene/GaussianSplatStress",
  function () {
    let scene;
    beforeEach(function () {
      scene = createScene({ canvas: createCanvas(512, 512) });
    });
    afterEach(function () {
      scene.destroyForSpecs();
      ResourceCache.clearForSpecs();
    });

    it("recovers independent splat tilesets with mixed content and budget changes", async function () {
      const splatUrl =
        "./Data/Cesium3DTiles/GaussianSplats/sh_unit_cube/tileset.json";
      const urls = [
        splatUrl,
        splatUrl,
        "./Data/Cesium3DTiles/Batched/BatchedWithBatchTable/tileset.json",
        "./Data/Cesium3DTiles/PointCloud/PointCloudRGB/tileset.json",
      ];
      const tilesets = await Promise.all(
        urls.map((url) => Cesium3DTileset.fromUrl(url)),
      );
      const center = tilesets[0].boundingSphere.center;
      for (const tileset of tilesets) {
        tileset.modelMatrix = Matrix4.fromTranslation(
          Cartesian3.subtract(
            center,
            tileset.boundingSphere.center,
            new Cartesian3(),
          ),
        );
        scene.primitives.add(tileset);
      }
      const range = tilesets[0].boundingSphere.radius * 2;
      scene.camera.lookAt(center, new HeadingPitchRange(0, -1, range));
      const splats = tilesets.slice(0, 2);
      async function settle() {
        await pollToPromise(
          function () {
            scene.renderForSpecs();
            return (
              tilesets.every(
                (t) => t.tilesLoaded && t._selectedTiles.length > 0,
              ) &&
              splats.every((t) => {
                const p = t.gaussianSplatPrimitive;
                return (
                  p?._numSplats > 0 && p.isStable && !p._needsSnapshotRebuild
                );
              })
            );
          },
          { timeout: 10000 },
        );
      }
      await settle();
      const counts = splats.map((t) => t.gaussianSplatPrimitive._numSplats);
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const tileset of splats) {
          tileset.cacheBytes = 0;
          tileset.maximumCacheOverflowBytes = 0;
        }
        for (let frame = 0; frame < 12; frame++) {
          scene.camera.lookAt(
            center,
            new HeadingPitchRange(frame * 0.4, -0.5, range),
          );
          scene.renderForSpecs();
          await Promise.resolve();
        }
        for (const tileset of splats) {
          tileset.cacheBytes = 512 * 1024 * 1024;
        }
        scene.camera.lookAt(center, new HeadingPitchRange(0, -1, range));
        await settle();
        expect(splats.map((t) => t.gaussianSplatPrimitive._numSplats)).toEqual(
          counts,
        );
        for (const tileset of tilesets) {
          expect(tileset.statistics.numberOfPendingRequests).toBe(0);
          expect(tileset.statistics.numberOfTilesProcessing).toBe(0);
        }
      }
      const first = splats[0].gaussianSplatPrimitive;
      const second = splats[1].gaussianSplatPrimitive;
      expect(first._sorterPositionsKey).not.toBe(second._sorterPositionsKey);
      scene.primitives.remove(splats[0]);
      expect(first.isDestroyed()).toBe(true);
      expect(first._texturesByteLength).toBe(0);
      expect(first._geometryByteLength).toBe(0);
      scene.camera.lookAt(center, new HeadingPitchRange(1, -0.5, range));
      await pollToPromise(function () {
        scene.renderForSpecs();
        return second.isStable;
      });
      expect(second.isDestroyed()).toBe(false);
      expect(second._numSplats).toBe(counts[1]);
      expect(second.gaussianSplatTexture.isDestroyed()).toBe(false);
    });
  },
  "WebGL",
);
