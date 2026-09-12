import {
  Cesium3DTileStyle,
  CustomShader,
  Model,
  ModelUtility,
  Resource,
} from "../../../index.js";
import createScene from "../../../../../Specs/createScene.js";
import pollToPromise from "../../../../../Specs/pollToPromise.js";

describe(
  "Scene/Model/PntsPropertyAttributes",
  function () {
    let scene;
    let model;

    beforeEach(function () {
      scene = createScene();
    });

    afterEach(function () {
      scene.destroyForSpecs();
    });

    async function load(name = "PointCloudWithPerPointProperties") {
      const filename = name[0].toLowerCase() + name.slice(1);
      const resource = new Resource({
        url: `./Data/Cesium3DTiles/PointCloud/${name}/${filename}.pnts`,
      });
      model = scene.primitives.add(
        await Model.fromPnts({
          resource,
          arrayBuffer: await resource.fetchArrayBuffer(),
          content: {
            tile: { refine: 1, geometricError: 0 },
            tileset: {
              isSkippingLevelOfDetail: false,
              memoryAdjustedScreenSpaceError: 16,
              timeSinceLoad: 0,
            },
          },
        }),
      );
      await pollToPromise(function () {
        scene.renderForSpecs();
        return model.ready;
      });
      scene.renderForSpecs();
    }

    function getAttribute(propertyId) {
      const property =
        model.structuralMetadata.propertyAttributes[0].properties[propertyId];
      const primitive = model.sceneGraph.components.nodes[0].primitives[0];
      return ModelUtility.getAttributeByName(primitive, property.attribute);
    }

    it("uploads only styled properties and releases buffers on destruction", async function () {
      await load();
      const temperature = getAttribute("temperature");
      const color = getAttribute("secondaryColor");
      const id = getAttribute("id");
      expect(temperature.buffer).toBeUndefined();
      expect(color.buffer).toBeUndefined();
      expect(id.buffer).toBeUndefined();
      expect(temperature.typedArray).toBeDefined();
      // Each deferred array owns only its property, not the complete tile payload.
      expect(temperature.typedArray.byteLength).toBe(
        temperature.typedArray.buffer.byteLength,
      );

      const accountedBytes = model.statistics.geometryByteLength;
      model.style = new Cesium3DTileStyle({
        show: "${temperature} > -1000000",
      });
      scene.renderForSpecs();
      const buffer = temperature.buffer;
      expect(buffer).toBeDefined();
      expect(temperature.typedArray).toBeUndefined();
      expect(color.buffer).toBeUndefined();
      expect(id.buffer).toBeUndefined();
      expect(model.statistics.geometryByteLength).toBe(accountedBytes);

      model.style = undefined;
      scene.renderForSpecs();
      expect(temperature.buffer).toBe(buffer);
      scene.primitives.remove(model);
      expect(buffer.isDestroyed()).toBe(true);
    });

    it("uploads custom shader metadata and attribute dependencies", async function () {
      await load();
      const temperature = getAttribute("temperature");
      const color = getAttribute("secondaryColor");
      const id = getAttribute("id");
      const variableName = ModelUtility.getAttributeInfo(color).variableName;
      model.customShader = new CustomShader({
        vertexShaderText: `void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
        vsOutput.positionMC += vsInput.attributes.${variableName};
      }`,
        fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        material.diffuse = vec3(fsInput.metadata.temperature);
      }`,
      });
      scene.renderForSpecs();
      expect(temperature.buffer).toBeDefined();
      expect(color.buffer).toBeDefined();
      expect(id.buffer).toBeUndefined();
    });

    it("resolves sanitized property identifiers in styles", async function () {
      await load("PointCloudWithUnicodePropertyIds");
      const temperature = getAttribute("temperature_");
      model.style = new Cesium3DTileStyle({
        defines: { value: "${temperature_}" },
        show: "${value} > -1000000",
      });
      scene.renderForSpecs();
      expect(temperature.buffer).toBeDefined();
      expect(getAttribute("secondaryColor").buffer).toBeUndefined();
      expect(getAttribute("id").buffer).toBeUndefined();
    });
  },
  "WebGL",
);
