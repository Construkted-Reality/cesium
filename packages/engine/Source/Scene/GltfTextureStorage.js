import destroyObject from "../Core/destroyObject.js";

const entries = new Map();

/** A sampler-specific view of shared glTF image storage. @private */
class GltfTextureView {
  constructor(entry, sampler) {
    this._entry = entry;
    const texture = entry.texture;
    this._texture = texture._texture;
    this._id = texture._id;
    this._target = texture._target;
    this._sampler = sampler;
    const gl = texture._context._gl;
    this._samplerObject = gl.createSampler();
    this.sampler = sampler;
    ++entry.references;
  }
  get width() {
    return this._entry.texture.width;
  }
  get height() {
    return this._entry.texture.height;
  }
  get dimensions() {
    return this._entry.texture.dimensions;
  }
  get sizeInBytes() {
    return this._entry.texture.sizeInBytes;
  }
  get pixelFormat() {
    return this._entry.texture.pixelFormat;
  }
  get pixelDatatype() {
    return this._entry.texture.pixelDatatype;
  }
  get sampler() {
    return this._sampler;
  }
  set sampler(sampler) {
    this._sampler = sampler;
    const texture = this._entry.texture;
    const gl = texture._context._gl;
    gl.samplerParameteri(this._samplerObject, gl.TEXTURE_WRAP_S, sampler.wrapS);
    gl.samplerParameteri(this._samplerObject, gl.TEXTURE_WRAP_T, sampler.wrapT);
    gl.samplerParameteri(
      this._samplerObject,
      gl.TEXTURE_MIN_FILTER,
      sampler.minificationFilter,
    );
    gl.samplerParameteri(
      this._samplerObject,
      gl.TEXTURE_MAG_FILTER,
      sampler.magnificationFilter,
    );
    const extension = texture._textureFilterAnisotropic;
    if (extension) {
      gl.samplerParameterf(
        this._samplerObject,
        extension.TEXTURE_MAX_ANISOTROPY_EXT,
        sampler.maximumAnisotropy,
      );
    }
  }
  isDestroyed() {
    return false;
  }
  destroy() {
    const entry = this._entry;
    entry.texture._context._gl.deleteSampler(this._samplerObject);
    if (--entry.references === 0) {
      entry.texture.destroy();
      entries.delete(entry.key);
    }
    return destroyObject(this);
  }
}

/** Reference-counted image storage for compatible WebGL 2 glTF samplers. @private */
const GltfTextureStorage = {
  getOrCreate(key, sampler, create) {
    let entry = entries.get(key);
    if (!entry) {
      entry = { key: key, texture: create(), references: 0 };
      entries.set(key, entry);
    }
    return new GltfTextureView(entry, sampler);
  },
};
export default GltfTextureStorage;
