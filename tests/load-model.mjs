import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Read the real exported geometry in Node. Materials/images are unnecessary for
// collision tests and removing them avoids browser-only image decoding APIs.
export async function loadModel(name){
  const file=await readFile(new URL(`../public/models/${name}.glb`,import.meta.url));
  const jsonLength=file.readUInt32LE(12);
  const json=JSON.parse(file.subarray(20,20+jsonLength).toString());
  const binary=file.subarray(28+jsonLength);
  delete json.images;delete json.textures;delete json.materials;
  for(const mesh of json.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  json.buffers[0].uri=`data:application/octet-stream;base64,${binary.toString('base64')}`;
  globalThis.ProgressEvent??=class{constructor(type,options){Object.assign(this,{type},options);}};
  return(await new GLTFLoader().parseAsync(JSON.stringify(json),'')).scene;
}
