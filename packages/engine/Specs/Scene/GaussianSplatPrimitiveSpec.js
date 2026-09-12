import {
  Cesium3DTileset,
  Event,
  PerspectiveFrustum,
  Math as CesiumMath,
  ResourceCache,
  RequestScheduler,
  HeadingPitchRange,
  Cartesian3,
  GaussianSplat3DTileContent,
  Matrix4,
  Transforms,
  VertexAttributeSemantic,
} from "../../index.js";
import GaussianSplatTextureGenerator from "../../Source/Scene/GaussianSplatTextureGenerator.js";
import GaussianSplatSorter from "../../Source/Scene/GaussianSplatSorter.js";
import GaussianSplatPrimitive from "../../Source/Scene/GaussianSplatPrimitive.js";

import Cesium3DTilesTester from "../../../../Specs/Cesium3DTilesTester.js";
import createScene from "../../../../Specs/createScene.js";
import createCanvas from "../../../../Specs/createCanvas.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe(
  "Scene/GaussianSplatPrimitive",
  function () {
    const sphericalHarmonicUrl =
      "./Data/Cesium3DTiles/GaussianSplats/sh_unit_cube/tileset.json";

    let scene;
    let options;
    let camera;

    const canvassize = { width: 512, height: 512 };
    const samplePosition =
      ((canvassize.width / 2) * canvassize.height + canvassize.width / 2) * 4;

    beforeAll(function () {
      const canvas = createCanvas(canvassize.width, canvassize.height);
      scene = createScene({ canvas });
    });

    afterAll(function () {
      scene.destroyForSpecs();
    });

    beforeEach(function () {
      RequestScheduler.clearForSpecs();
      scene.morphTo3D(0.0);

      camera = scene.camera;
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

    function createSortFixture() {
      const tileset = {
        show: true,
        splitDirection: 0,
        _selectedTiles: [],
        tileLoad: new Event(),
        tileVisible: new Event(),
        update: function () {},
      };
      const primitive = new GaussianSplatPrimitive({ tileset });
      tileset.gaussianSplatPrimitive = primitive;
      primitive._rootTransform = Matrix4.clone(Matrix4.IDENTITY);
      primitive._positions = new Float32Array([0, 0, 1, 0, 0, -1]);
      primitive._numSplats = 2;
      primitive._indexes = new Uint32Array([0, 1]);
      primitive._drawCommand = {};
      primitive._snapshot = {};
      const frame = {
        frameNumber: 100,
        passes: {},
        commandList: [],
        camera: {
          viewMatrix: Matrix4.clone(Matrix4.IDENTITY),
          positionWC: new Cartesian3(),
          directionWC: new Cartesian3(0, 0, -1),
        },
      };
      return { primitive, frame, tileset };
    }

    it("trims unused staging arrays while preserving both snapshots", function () {
      const { primitive, tileset } = createSortFixture();
      const active = new Float32Array(6);
      const pending = new Float32Array(9);
      const free = new Float32Array(12);
      const pendingColors = new Uint8Array(12);
      const sh = new Uint32Array(16);
      primitive._snapshot.positions = active;
      primitive._pendingSnapshot = {
        positions: pending.subarray(0, 6),
        colors: pendingColors.subarray(0, 8),
        shData: sh.subarray(0, 8),
      };
      primitive._aggregateScratchBuffers = {
        positions: [active, pending, free],
        colors: [pendingColors, new Uint8Array(16)],
      };
      primitive._scratchAggregateShBuffer = sh;
      const trim = jasmine.createSpy("trim");
      tileset._cache = { trim };
      Cesium3DTileset.prototype.trimLoadedTiles.call(tileset);
      expect(trim).toHaveBeenCalled();
      expect(primitive._aggregateScratchBuffers.positions).toEqual([
        active,
        pending,
      ]);
      expect(primitive._aggregateScratchBuffers.colors).toEqual([
        pendingColors,
      ]);
      expect(primitive._scratchAggregateShBuffer).toBe(sh);
      expect(primitive._snapshot.positions).toBe(active);

      primitive._pendingSnapshot = undefined;
      primitive.trimScratchBuffers();
      expect(primitive._aggregateScratchBuffers.positions).toEqual([active]);
      expect(primitive._aggregateScratchBuffers.colors).toEqual([]);
      expect(primitive._scratchAggregateShBuffer).toBeUndefined();
      primitive.trimScratchBuffers();
      expect(primitive._aggregateScratchBuffers.positions).toEqual([active]);
      primitive.destroy();
    });

    it("retries a cache miss after the camera stops", async function () {
      const { primitive, frame } = createSortFixture();
      const sorted = new Uint32Array([1, 0]);
      const sort = spyOn(
        GaussianSplatSorter,
        "radixSortIndexes",
      ).and.returnValues(Promise.resolve(undefined), Promise.resolve(sorted));
      primitive.update(frame);
      await Promise.resolve();
      frame.frameNumber++;
      primitive.update(frame);
      await Promise.resolve();
      expect(sort.calls.count()).toBe(2);
      expect(sort.calls.mostRecent().args[0].primitive.positions).toEqual(
        primitive._positions,
      );
      expect(primitive._indexes).toBe(sorted);
      primitive.destroy();
    });

    it("resends positions and uses the current view after unavailable capacity", async function () {
      const { primitive, frame } = createSortFixture();
      const sort = spyOn(
        GaussianSplatSorter,
        "radixSortIndexes",
      ).and.returnValues(undefined, Promise.resolve(new Uint32Array([1, 0])));
      primitive.update(frame);
      expect(primitive._sorterPositionsKey).toBe(0);
      frame.camera.viewMatrix[10] = -1;
      frame.frameNumber++;
      primitive.update(frame);
      await Promise.resolve();
      expect(sort.calls.count()).toBe(2);
      expect(sort.calls.mostRecent().args[0].primitive.positions).toEqual(
        primitive._positions,
      );
      expect(sort.calls.mostRecent().args[0].primitive.modelView[10]).toBe(-1);
      primitive.destroy();
    });

    it("ignores a pending sort completion after destruction", async function () {
      const { primitive, frame, tileset } = createSortFixture();
      let resolve;
      spyOn(GaussianSplatSorter, "radixSortIndexes").and.returnValue(
        new Promise((complete) => {
          resolve = complete;
        }),
      );
      primitive.update(frame);
      primitive.destroy();
      resolve(new Uint32Array([1, 0]));
      await Promise.resolve();
      expect(primitive.isDestroyed()).toBe(true);
      expect(primitive._indexes).toBeUndefined();
      expect(tileset.gaussianSplatPrimitive).toBeUndefined();
      expect(tileset.tileLoad.numberOfListeners).toBe(0);
      expect(tileset.tileVisible.numberOfListeners).toBe(0);
    });

    it("destroys the aggregate primitive when its tileset is removed", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        sphericalHarmonicUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      await Cesium3DTilesTester.waitForTileContentReady(scene, tileset.root);
      const primitive = tileset.gaussianSplatPrimitive;
      expect(primitive).toBeDefined();
      scene.primitives.remove(tileset);
      expect(primitive.isDestroyed()).toBe(true);
    });

    function makeTile() {
      return {
        computedTransform: Matrix4.IDENTITY,
        content: {
          worldTransform: Matrix4.IDENTITY,
          pointsLength: 1,
          positions: new Float32Array(3),
          scales: new Float32Array(3),
          rotations: new Float32Array(4),
          gltfPrimitive: {
            attributes: [
              {
                semantic: "COLOR",
                type: "VEC4",
                typedArray: new Uint8Array(4),
              },
            ],
          },
          sphericalHarmonicsDegree: 0,
        },
      };
    }

    it("reuses uploaded scratch arrays while preserving sort positions", async function () {
      const { primitive, frame, tileset } = createSortFixture();
      tileset.boundingSphere = {
        center: Cartesian3.fromDegrees(0, 0),
        radius: 10,
      };
      tileset._selectedTiles = [makeTile()];
      primitive._snapshot = undefined;
      primitive._drawCommand = undefined;
      spyOn(GaussianSplatPrimitive, "transformTile");
      const inputs = [];
      spyOn(GaussianSplatPrimitive, "generateSplatTexture").and.callFake(
        (owner, state, snapshot) => {
          inputs.push({
            positions: snapshot.positions,
            scales: snapshot.scales,
            rotations: snapshot.rotations,
            colors: snapshot.colors,
          });
          snapshot.gaussianSplatTexture = { destroy: function () {} };
          snapshot.state =
            inputs.length === 1 ? "TEXTURE_READY" : "TEXTURE_PENDING";
        },
      );
      spyOn(GaussianSplatSorter, "radixSortIndexes").and.returnValue(
        Promise.resolve(new Uint32Array([0])),
      );
      spyOn(GaussianSplatPrimitive, "buildGSplatDrawCommand");
      async function nextFrame() {
        frame.frameNumber++;
        primitive.update(frame);
        await Promise.resolve();
      }
      try {
        for (let i = 0; i < 90 && !primitive._snapshot; i++) {
          await nextFrame();
        }
        expect(primitive._snapshot).toBeDefined();
        const committed = primitive._snapshot;
        expect(primitive._positions).toBe(inputs[0].positions);
        for (const key of ["scales", "rotations", "colors", "shData"]) {
          expect(committed[key]).toBeUndefined();
          expect(primitive[`_${key}`]).toBeUndefined();
        }
        primitive._dirty = true;
        for (let i = 0; i < 90 && inputs.length < 2; i++) {
          await nextFrame();
        }
        expect(inputs.length).toBe(2);
        expect(primitive._snapshot).toBe(committed);
        expect(primitive._positions).toBe(inputs[0].positions);
        expect(inputs[1].positions.buffer).not.toBe(inputs[0].positions.buffer);
        for (const key of ["scales", "rotations", "colors"]) {
          expect(inputs[1][key].buffer).toBe(inputs[0][key].buffer);
        }
        primitive._pendingSnapshot.state = "TEXTURE_READY";
        await nextFrame();
        expect(primitive._snapshot).not.toBe(committed);
        expect(primitive._positions).toBe(inputs[1].positions);
      } finally {
        primitive.destroy();
      }
    });

    [false, true].forEach(function (selectionChanged) {
      it(`recovers a failed snapshot, selectionChanged=${selectionChanged}`, async function () {
        const { primitive, frame, tileset } = createSortFixture();
        tileset.boundingSphere = {
          center: Cartesian3.fromDegrees(0, 0),
          radius: 10,
        };
        const a = makeTile();
        const b = makeTile();
        tileset._selectedTiles = [a];
        spyOn(GaussianSplatPrimitive, "transformTile");
        spyOn(console, "error");
        spyOn(
          GaussianSplatTextureGenerator,
          "generateFromAttributes",
        ).and.callFake(() => Promise.reject(new Error("Snapshot A fails")));
        // Force the initial snapshot without waiting for selection stability.
        primitive._snapshot = undefined;
        primitive._drawCommand = undefined;
        primitive.update(frame);
        await Promise.resolve();
        const failed = primitive._pendingSnapshot;
        expect(failed.state).toBe("BUILDING");

        tileset._selectedTiles = [selectionChanged ? b : a];
        spyOn(GaussianSplatPrimitive, "generateSplatTexture").and.callFake(
          (owner, state, snapshot) => {
            snapshot.state = "TEXTURE_READY";
            snapshot.gaussianSplatTexture = { destroy: function () {} };
          },
        );
        spyOn(GaussianSplatSorter, "radixSortIndexes").and.returnValue(
          Promise.resolve(new Uint32Array([0])),
        );
        spyOn(GaussianSplatPrimitive, "buildGSplatDrawCommand");
        frame.frameNumber++;
        primitive.update(frame);
        const replacement = primitive._pendingSnapshot;
        if (selectionChanged) {
          expect(replacement).not.toBe(failed);
        } else {
          expect(replacement).toBe(failed);
        }
        frame.frameNumber++;
        primitive.update(frame);
        await Promise.resolve();
        expect(primitive._snapshot).toBe(replacement);
        expect(primitive._selectedTileSet.has(selectionChanged ? b : a)).toBe(
          true,
        );
        expect(primitive._pendingSnapshot).toBeUndefined();
        primitive.destroy();
      });
    });

    it("commits a pending snapshot despite disjoint selection churn", async function () {
      const { primitive, frame, tileset } = createSortFixture();
      tileset.boundingSphere = {
        center: Cartesian3.fromDegrees(0, 0),
        radius: 10,
      };

      const a = makeTile();
      const b = makeTile();
      primitive._selectedTileSet = new Set([a]);
      spyOn(GaussianSplatPrimitive, "transformTile");
      const generate = spyOn(
        GaussianSplatPrimitive,
        "generateSplatTexture",
      ).and.callFake((owner, state, snapshot) => {
        snapshot.state = "TEXTURE_PENDING";
      });
      for (let i = 0; i < 60; i++) {
        frame.frameNumber++;
        tileset._selectedTiles = [i % 2 === 0 ? b : a];
        primitive.update(frame);
      }
      expect(generate.calls.count()).toBe(1);
      const pending = primitive._pendingSnapshot;
      pending.state = "TEXTURE_READY";
      pending.gaussianSplatTexture = { destroy: function () {} };
      spyOn(GaussianSplatSorter, "radixSortIndexes").and.returnValue(
        Promise.resolve(new Uint32Array([0])),
      );
      spyOn(GaussianSplatPrimitive, "buildGSplatDrawCommand");
      primitive.update(frame);
      await Promise.resolve();
      expect(primitive._snapshot).toBe(pending);
      expect(primitive._pendingSnapshot).toBeUndefined();
      frame.frameNumber++;
      primitive.update(frame);
      expect(generate.calls.count()).toBe(2);
      primitive.destroy();
    });

    it("skips an identical depth row but sorts a changed model-view row", async function () {
      const { primitive, frame } = createSortFixture();
      const sort = spyOn(
        GaussianSplatSorter,
        "radixSortIndexes",
      ).and.returnValue(Promise.resolve(new Uint32Array([1, 0])));
      spyOn(GaussianSplatPrimitive, "buildGSplatDrawCommand");
      primitive.update(frame);
      await Promise.resolve();
      primitive.update(frame);
      frame.frameNumber += 10;
      frame.camera.positionWC.x = 10;
      frame.camera.viewMatrix[12] = 10;
      primitive.update(frame);
      expect(sort.calls.count()).toBe(1);
      frame.camera.viewMatrix[2] = 0.25;
      frame.camera.directionWC.x = 0.25;
      frame.frameNumber += 10;
      primitive.update(frame);
      await Promise.resolve();
      expect(sort.calls.count()).toBe(2);
      primitive.destroy();
    });

    it("reuses command capacity and refreshes texture and debug state", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        sphericalHarmonicUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0, -1.57, tileset.boundingSphere.radius),
      );
      await Cesium3DTilesTester.waitForTileContentReady(scene, tileset.root);
      const p = tileset.gaussianSplatPrimitive;
      await pollToPromise(function () {
        scene.renderForSpecs();
        return p.isStable;
      });
      const command = p._drawCommand;
      const capacity = p._vertexArrayLen;
      const full = p._indexes;
      p._indexes = full.subarray(0, Math.max(1, full.length - 1));
      tileset.debugShowBoundingVolume = true;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
      expect(p._drawCommand).toBe(command);
      expect(p._vertexArrayLen).toBe(capacity);
      expect(command.instanceCount).toBe(p._indexes.length);
      expect(command.debugShowBoundingVolume).toBe(true);
      const texture = p.gaussianSplatTexture;
      p.gaussianSplatTexture = {};
      expect(command.uniformMap.u_splatAttributeTexture()).toBe(
        p.gaussianSplatTexture,
      );
      p.gaussianSplatTexture = texture;
      p._indexes = full;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
      expect(p._drawCommand).toBe(command);
      expect(command.instanceCount).toBe(full.length);
      const degree = p._sphericalHarmonicsDegree;
      p._sphericalHarmonicsDegree = 0;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
      expect(p._drawCommand).not.toBe(command);
      p._sphericalHarmonicsDegree = degree;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
      expect(p._drawCommandDegree).toBe(degree);
      const grown = new Uint32Array(capacity + 1);
      p._indexes = grown;
      const oldArray = p._vertexArray;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
      expect(p._vertexArray).not.toBe(oldArray);
      expect(p._vertexArrayLen).toBe(grown.length);
      p._indexes = full;
      p.constructor.buildGSplatDrawCommand(p, scene.frameState);
    });

    it("pads mixed harmonics degrees without borrowing coefficients from adjacent splats", function () {
      const { primitive, frame, tileset } = createSortFixture();
      tileset.boundingSphere = {
        center: Cartesian3.fromDegrees(0, 0),
        radius: 10,
      };
      primitive._snapshot = undefined;
      primitive._drawCommand = undefined;
      const makeTile = (degree) => ({
        computedTransform: Matrix4.IDENTITY,
        content: {
          worldTransform: Matrix4.IDENTITY,
          pointsLength: 2,
          positions: new Float32Array(6),
          scales: new Float32Array(6),
          rotations: new Float32Array(8),
          gltfPrimitive: {
            attributes: [
              {
                semantic: "COLOR",
                type: "VEC4",
                typedArray: new Uint8Array(8),
              },
            ],
          },
          sphericalHarmonicsDegree: degree,
          sphericalHarmonicsCoefficientCount: [0, 9, 24, 45][degree],
          packedSphericalHarmonicsData:
            degree === 0
              ? undefined
              : new Uint32Array(
                  2 * Math.ceil([0, 9, 24, 45][degree] / 4) * 2,
                ).fill(degree),
        },
      });
      tileset._selectedTiles = [makeTile(0), makeTile(2), makeTile(3)];
      spyOn(GaussianSplatPrimitive, "transformTile");
      spyOn(GaussianSplatPrimitive, "generateSplatTexture");
      primitive.update(frame);
      const pending = primitive._pendingSnapshot;
      expect(pending.sphericalHarmonicsDegree).toBe(3);
      expect(pending.shData.length).toBe(6 * 24);
      expect(Array.from(pending.shData.slice(0, 48))).toEqual(
        new Array(48).fill(0),
      );
      for (let splat = 2; splat < 4; splat++) {
        expect(
          Array.from(pending.shData.slice(splat * 24, splat * 24 + 12)),
        ).toEqual(new Array(12).fill(2));
        expect(
          Array.from(pending.shData.slice(splat * 24 + 12, (splat + 1) * 24)),
        ).toEqual(new Array(12).fill(0));
      }
      expect(Array.from(pending.shData.slice(96))).toEqual(
        new Array(48).fill(3),
      );
      primitive.destroy();
    });

    it("loads a Gaussian splats tileset", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        sphericalHarmonicUrl,
        options,
      );
      scene.camera.lookAt(
        tileset.boundingSphere.center,
        new HeadingPitchRange(0.0, -1.57, tileset.boundingSphere.radius),
      );
      expect(tileset.hasExtension("3DTILES_content_gltf")).toBe(true);
      expect(
        tileset.isGltfExtensionUsed("KHR_gaussian_splatting_compression_spz_2"),
      ).toBe(true);
      expect(tileset.isGltfExtensionRequired("KHR_gaussian_splatting")).toBe(
        true,
      );
      expect(
        tileset.isGltfExtensionRequired(
          "KHR_gaussian_splatting_compression_spz_2",
        ),
      ).toBe(true);

      const tile = await Cesium3DTilesTester.waitForTileContentReady(
        scene,
        tileset.root,
      );

      expect(tile.content).toBeDefined();
      expect(tile.content instanceof GaussianSplat3DTileContent).toBe(true);
    });

    it("loads a Gaussian splats tileset and toggles visibility", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        sphericalHarmonicUrl,
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

      expect(tile.content).toBeDefined();

      const gsPrim = tileset.gaussianSplatPrimitive;
      expect(gsPrim).toBeDefined();

      await pollToPromise(function () {
        scene.renderForSpecs();
        return gsPrim.isStable;
      });
      scene.renderForSpecs();
      expect(scene).toRenderAndCall(function (rgba) {
        expect(rgba[samplePosition + 0]).not.toBe(0);
        expect(rgba[samplePosition + 1]).not.toBe(0);
        expect(rgba[samplePosition + 2]).not.toBe(0);
      });

      tileset.show = false;
      scene.renderForSpecs();
      expect(scene).toRenderAndCall(function (rgba) {
        expect(rgba[samplePosition + 0]).toBe(0);
        expect(rgba[samplePosition + 1]).toBe(0);
        expect(rgba[samplePosition + 2]).toBe(0);
      });
    });

    it("retries pending snapshot sorting when sorter is temporarily unavailable", function () {
      const tileset = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: undefined,
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: {
          addEventListener: function () {},
        },
        tileVisible: {
          addEventListener: function () {},
        },
        update: function () {},
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset: tileset });
      gsPrim._rootTransform = Matrix4.IDENTITY;

      // Force the pending-snapshot TEXTURE_READY path deterministically.
      // This validates "unavailable sorter -> keep TEXTURE_READY -> retry next frame"
      // without depending on async texture generation timing.
      const fakeTexture = {
        destroy: function () {},
      };
      gsPrim._pendingSnapshot = {
        generation: gsPrim._splatDataGeneration,
        positions: new Float32Array([0.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
        rotations: new Float32Array([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]),
        scales: new Float32Array([1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
        colors: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]),
        shData: undefined,
        sphericalHarmonicsDegree: 0,
        shCoefficientCount: 0,
        numSplats: 2,
        indexes: undefined,
        gaussianSplatTexture: fakeTexture,
        sphericalHarmonicsTexture: undefined,
        lastTextureWidth: 1,
        lastTextureHeight: 1,
        state: "SORTING",
      };
      gsPrim._pendingSortPromise = undefined;
      gsPrim._pendingSort = undefined;
      gsPrim._sorterPromise = undefined;
      gsPrim._sorterState = 0;
      gsPrim._dirty = false;
      gsPrim._needsSnapshotRebuild = false;
      gsPrim._selectedTileSet = new Set();
      gsPrim._selectedTilesStableFrames = 2;

      const frameState = {
        frameNumber: 1,
        camera: {
          viewMatrix: Matrix4.clone(Matrix4.IDENTITY, new Matrix4()),
          positionWC: Cartesian3.clone(Cartesian3.ZERO, new Cartesian3()),
          directionWC: Cartesian3.clone(Cartesian3.UNIT_Z, new Cartesian3()),
        },
        commandList: [],
        passes: {
          pick: false,
        },
      };

      gsPrim.update(frameState);

      expect(gsPrim._pendingSnapshot).toBeDefined();
      expect(gsPrim._pendingSnapshot.state).toBe("TEXTURE_READY");
      expect(gsPrim._pendingSortPromise).toBeUndefined();
      gsPrim.destroy();
    });

    it("inflates maximumScreenSpaceError during traversal and restores it when splatBudgetSSEScale > 1", function () {
      let capturedSSEDuringTraversal;
      const tileset = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: undefined,
        maximumScreenSpaceError: 16,
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: { addEventListener: function () {} },
        tileVisible: { addEventListener: function () {} },
        update: function () {
          capturedSSEDuringTraversal = this.maximumScreenSpaceError;
        },
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset });
      gsPrim._splatBudgetSSEScale = 5.0;

      const frameState = {
        frameNumber: 1,
        camera: {
          viewMatrix: Matrix4.clone(Matrix4.IDENTITY, new Matrix4()),
          positionWC: Cartesian3.clone(Cartesian3.ZERO, new Cartesian3()),
          directionWC: Cartesian3.clone(Cartesian3.UNIT_Z, new Cartesian3()),
        },
        commandList: [],
        passes: { pick: false },
      };

      gsPrim._wrappedUpdate(frameState);

      // SSE seen inside traversal must be originalSSE × scale
      expect(capturedSSEDuringTraversal).toBe(80);
      // SSE must be restored to original value afterward
      expect(tileset.maximumScreenSpaceError).toBe(16);
      gsPrim.destroy();
    });

    it("does not modify maximumScreenSpaceError when splatBudgetSSEScale is 1", function () {
      let capturedSSEDuringTraversal;
      const tileset = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: undefined,
        maximumScreenSpaceError: 16,
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: { addEventListener: function () {} },
        tileVisible: { addEventListener: function () {} },
        update: function () {
          capturedSSEDuringTraversal = this.maximumScreenSpaceError;
        },
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset });
      gsPrim._splatBudgetSSEScale = 1.0;

      const frameState = {
        frameNumber: 1,
        camera: {
          viewMatrix: Matrix4.clone(Matrix4.IDENTITY, new Matrix4()),
          positionWC: Cartesian3.clone(Cartesian3.ZERO, new Cartesian3()),
          directionWC: Cartesian3.clone(Cartesian3.UNIT_Z, new Cartesian3()),
        },
        commandList: [],
        passes: { pick: false },
      };

      gsPrim._wrappedUpdate(frameState);

      expect(capturedSSEDuringTraversal).toBe(16);
      expect(tileset.maximumScreenSpaceError).toBe(16);
      gsPrim.destroy();
    });

    it("transformTile bakes tileset transform into splat positions", function () {
      const tilesetMock = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: { center: Cartesian3.ZERO },
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: { addEventListener: function () {} },
        tileVisible: { addEventListener: function () {} },
        update: function () {},
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset: tilesetMock });
      tilesetMock.gaussianSplatPrimitive = gsPrim;
      // Override axis correction and rootTransform to identity so the test
      // isolates the computedTransform baking behavior.
      gsPrim._axisCorrectionMatrix = Matrix4.clone(Matrix4.IDENTITY);
      gsPrim._rootTransform = Matrix4.clone(Matrix4.IDENTITY);
      // computedTransform represents the product of tileset.modelMatrix and
      // tile transforms.  The baked output position should equal the transformed
      // input, not be cancelled by toLocal.
      const translation = new Cartesian3(5, 3, 1);
      const computedTransform = Matrix4.fromTranslation(
        translation,
        new Matrix4(),
      );
      const srcPositions = new Float32Array([0, 0, 0]);
      const srcRotations = new Float32Array([0, 0, 0, 1]);
      const srcScales = new Float32Array([1, 1, 1]);
      const outPositions = new Float32Array(3);
      const outRotations = new Float32Array(4);
      const outScales = new Float32Array(3);
      const tile = {
        computedTransform: computedTransform,
        tileset: tilesetMock,
        content: {
          gltfPrimitive: {
            attributes: [
              {
                semantic: VertexAttributeSemantic.POSITION,
                typedArray: srcPositions,
              },
              {
                semantic: VertexAttributeSemantic.ROTATION,
                typedArray: srcRotations,
              },
              {
                semantic: VertexAttributeSemantic.SCALE,
                typedArray: srcScales,
              },
            ],
          },
          worldTransform: Matrix4.clone(Matrix4.IDENTITY),
          positions: outPositions,
          rotations: outRotations,
          scales: outScales,
        },
      };
      GaussianSplatPrimitive.transformTile(tile);
      // The translated position must be baked into the output values.
      expect(outPositions[0]).toBeCloseTo(translation.x, 5);
      expect(outPositions[1]).toBeCloseTo(translation.y, 5);
      expect(outPositions[2]).toBeCloseTo(translation.z, 5);
      expect(tile.content._transformed).toBe(true);
      gsPrim.destroy();
    });

    it("transformTile re-applies from original glTF attributes when the transform changes", function () {
      const tilesetMock = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: { center: Cartesian3.ZERO },
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: { addEventListener: function () {} },
        tileVisible: { addEventListener: function () {} },
        update: function () {},
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset: tilesetMock });
      tilesetMock.gaussianSplatPrimitive = gsPrim;
      gsPrim._axisCorrectionMatrix = Matrix4.clone(Matrix4.IDENTITY);
      gsPrim._rootTransform = Matrix4.clone(Matrix4.IDENTITY);

      const srcPositions = new Float32Array([1, 0, 0]);
      const srcRotations = new Float32Array([0, 0, 0, 1]);
      const srcScales = new Float32Array([1, 1, 1]);
      const outPositions = new Float32Array(3);
      const outRotations = new Float32Array(4);
      const outScales = new Float32Array(3);
      const tile = {
        computedTransform: Matrix4.fromTranslation(
          new Cartesian3(5, 0, 0),
          new Matrix4(),
        ),
        tileset: tilesetMock,
        content: {
          gltfPrimitive: {
            attributes: [
              {
                semantic: VertexAttributeSemantic.POSITION,
                typedArray: srcPositions,
              },
              {
                semantic: VertexAttributeSemantic.ROTATION,
                typedArray: srcRotations,
              },
              {
                semantic: VertexAttributeSemantic.SCALE,
                typedArray: srcScales,
              },
            ],
          },
          worldTransform: Matrix4.clone(Matrix4.IDENTITY),
          positions: outPositions,
          rotations: outRotations,
          scales: outScales,
          _transformed: false,
          _lastSplatTransform: undefined,
        },
      };

      GaussianSplatPrimitive.transformTile(tile);
      expect(outPositions[0]).toBeCloseTo(6.0, 5);
      expect(outPositions[1]).toBeCloseTo(0.0, 5);
      expect(outPositions[2]).toBeCloseTo(0.0, 5);
      expect(tile.content._transformed).toBe(true);

      tile.computedTransform = Matrix4.fromTranslation(
        new Cartesian3(10, 0, 0),
        new Matrix4(),
      );
      GaussianSplatPrimitive.transformTile(tile);

      expect(outPositions[0]).toBeCloseTo(11.0, 5);
      expect(outPositions[1]).toBeCloseTo(0.0, 5);
      expect(outPositions[2]).toBeCloseTo(0.0, 5);
      gsPrim.destroy();
    });

    it("transformTile skips recomputing when the cached transform is unchanged", function () {
      const tilesetMock = {
        show: true,
        splitDirection: 0,
        modelMatrix: Matrix4.IDENTITY,
        boundingSphere: { center: Cartesian3.ZERO },
        _modelMatrixChanged: false,
        _selectedTiles: [],
        tileLoad: { addEventListener: function () {} },
        tileVisible: { addEventListener: function () {} },
        update: function () {},
      };
      const gsPrim = new GaussianSplatPrimitive({ tileset: tilesetMock });
      tilesetMock.gaussianSplatPrimitive = gsPrim;
      gsPrim._axisCorrectionMatrix = Matrix4.clone(Matrix4.IDENTITY);
      gsPrim._rootTransform = Matrix4.clone(Matrix4.IDENTITY);

      const transform = Matrix4.fromTranslation(
        new Cartesian3(5, 3, 1),
        new Matrix4(),
      );
      const outPositions = new Float32Array([123, 456, 789]);
      const outRotations = new Float32Array([9, 8, 7, 6]);
      const outScales = new Float32Array([4, 5, 6]);
      const tile = {
        computedTransform: transform,
        tileset: tilesetMock,
        content: {
          gltfPrimitive: {
            attributes: [
              {
                semantic: VertexAttributeSemantic.POSITION,
                typedArray: new Float32Array([1, 2, 3]),
              },
              {
                semantic: VertexAttributeSemantic.ROTATION,
                typedArray: new Float32Array([0, 0, 0, 1]),
              },
              {
                semantic: VertexAttributeSemantic.SCALE,
                typedArray: new Float32Array([1, 1, 1]),
              },
            ],
          },
          worldTransform: Matrix4.clone(Matrix4.IDENTITY),
          positions: outPositions,
          rotations: outRotations,
          scales: outScales,
          _transformed: true,
          _lastSplatTransform: Matrix4.clone(transform, new Matrix4()),
        },
      };

      GaussianSplatPrimitive.transformTile(tile);

      expect(Array.from(outPositions)).toEqual([123, 456, 789]);
      expect(Array.from(outRotations)).toEqual([9, 8, 7, 6]);
      expect(Array.from(outScales)).toEqual([4, 5, 6]);
      gsPrim.destroy();
    });

    it("Check Spherical Harmonic specular on a Gaussian splats tileset", async function () {
      const tileset = await Cesium3DTilesTester.loadTileset(
        scene,
        sphericalHarmonicUrl,
        options,
      );

      const boundingSphere = tileset.boundingSphere;
      const yellowish = new HeadingPitchRange(
        CesiumMath.toRadians(231),
        CesiumMath.toRadians(-75),
        tileset.boundingSphere.radius / 10,
      );
      const orangeish = new HeadingPitchRange(
        CesiumMath.toRadians(2),
        CesiumMath.toRadians(-76),
        tileset.boundingSphere.radius / 10,
      );
      const purplish = new HeadingPitchRange(
        CesiumMath.toRadians(100),
        CesiumMath.toRadians(66),
        tileset.boundingSphere.radius / 10,
      );
      const targetOrange = { red: 210, green: 156, blue: 98 };
      const targetYellow = { red: 189, green: 173, blue: 97 };
      const targetPurple = { red: 127, green: 80, blue: 141 };

      tileset.show = true;

      const enu = Transforms.eastNorthUpToFixedFrame(boundingSphere.center);

      scene.camera.lookAtTransform(enu, yellowish);

      await Cesium3DTilesTester.waitForTileContentReady(scene, tileset.root);

      const gsPrim = tileset.gaussianSplatPrimitive;
      await pollToPromise(function () {
        scene.renderForSpecs();
        return gsPrim.isStable;
      });

      for (let i = 0; i < 100; ++i) {
        scene.renderForSpecs();
      }

      scene.renderForSpecs();
      expect(scene).toRenderAndCall(function (rgba) {
        expect(rgba[samplePosition + 0]).toBeCloseTo(targetYellow.red, -10);
        expect(rgba[samplePosition + 1]).toBeCloseTo(targetYellow.green, -10);
        expect(rgba[samplePosition + 2]).toBeCloseTo(targetYellow.blue, -10);
      });

      scene.camera.lookAtTransform(enu, orangeish);

      await Cesium3DTilesTester.waitForTileContentReady(scene, tileset.root);
      await pollToPromise(function () {
        scene.renderForSpecs();
        return gsPrim.isStable;
      });

      scene.renderForSpecs();
      expect(scene).toRenderAndCall(function (rgba) {
        expect(rgba[samplePosition + 0]).toBeCloseTo(targetOrange.red, -10);
        expect(rgba[samplePosition + 1]).toBeCloseTo(targetOrange.green, -10);
        expect(rgba[samplePosition + 2]).toBeCloseTo(targetOrange.blue, -10);
      });
      scene.camera.lookAtTransform(enu, purplish);

      await Cesium3DTilesTester.waitForTileContentReady(scene, tileset.root);
      await pollToPromise(function () {
        scene.renderForSpecs();
        return gsPrim.isStable;
      });

      scene.renderForSpecs();
      expect(scene).toRenderAndCall(function (rgba) {
        expect(rgba[samplePosition + 0]).toBeCloseTo(targetPurple.red, -10);
        expect(rgba[samplePosition + 1]).toBeCloseTo(targetPurple.green, -10);
        expect(rgba[samplePosition + 2]).toBeCloseTo(targetPurple.blue, -10);
      });
    });
  },
  "WebGL",
);
