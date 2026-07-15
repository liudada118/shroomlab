import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const inputPath = path.resolve('public/model/hand0423g.glb');
const outputPath = path.resolve('public/model/hand0423g_skinned.glb');
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function align4(value) {
  return (value + 3) & ~3;
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Input is not a GLB file.');

  let offset = 12;
  let json;
  let binary;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8').trim());
    if (chunkType === BIN_CHUNK) binary = Buffer.from(chunk);
    offset += 8 + chunkLength;
  }

  if (!json || !binary) throw new Error('GLB must contain JSON and BIN chunks.');
  return { json, binary };
}

function nodeLocalMatrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(node.translation || [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
    new THREE.Vector3(...(node.scale || [1, 1, 1])),
  );
}

function buildWorldMatrices(nodes) {
  const parents = new Map();
  nodes.forEach((node, parentIndex) => {
    (node.children || []).forEach((childIndex) => parents.set(childIndex, parentIndex));
  });

  const matrices = [];
  const resolve = (index) => {
    if (matrices[index]) return matrices[index];
    const local = nodeLocalMatrix(nodes[index]);
    const parentIndex = parents.get(index);
    matrices[index] = parentIndex === undefined ? local : resolve(parentIndex).clone().multiply(local);
    return matrices[index];
  };

  nodes.forEach((_, index) => resolve(index));
  return matrices;
}

function readPositionAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
    throw new Error('Expected FLOAT VEC3 position accessor.');
  }

  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = bufferView.byteStride || 12;
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const positions = new Float32Array(accessor.count * 3);

  for (let index = 0; index < accessor.count; index += 1) {
    const sourceOffset = byteOffset + index * byteStride;
    positions[index * 3] = view.getFloat32(sourceOffset, true);
    positions[index * 3 + 1] = view.getFloat32(sourceOffset + 4, true);
    positions[index * 3 + 2] = view.getFloat32(sourceOffset + 8, true);
  }

  return positions;
}

function distanceSquaredToSegment(point, start, end) {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return point.distanceToSquared(start);
  const amount = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
  return point.distanceToSquared(start.clone().addScaledVector(segment, amount));
}

function buildBoneSegments(json, skin, worldMatrices) {
  const jointSet = new Set(skin.joints);
  const jointToSkinIndex = new Map(skin.joints.map((nodeIndex, skinIndex) => [nodeIndex, skinIndex]));
  const positions = new Map(
    skin.joints.map((nodeIndex) => [
      nodeIndex,
      new THREE.Vector3().setFromMatrixPosition(worldMatrices[nodeIndex]),
    ]),
  );
  const segments = [];

  skin.joints.forEach((nodeIndex) => {
    const children = (json.nodes[nodeIndex].children || []).filter((childIndex) => jointSet.has(childIndex));
    children.forEach((childIndex) => {
      segments.push({
        boneIndex: jointToSkinIndex.get(nodeIndex),
        boneName: json.nodes[nodeIndex].name,
        start: positions.get(nodeIndex),
        end: positions.get(childIndex),
      });
    });
  });

  return segments;
}

function buildSmoothSkinAttributes(positions, meshMatrix, segments) {
  const vertexCount = positions.length / 3;
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  const point = new THREE.Vector3();
  const boneUse = new Map();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    point
      .set(
        positions[vertexIndex * 3],
        positions[vertexIndex * 3 + 1],
        positions[vertexIndex * 3 + 2],
      )
      .applyMatrix4(meshMatrix);

    const rankedSegments = segments
      .map((segment) => ({
        segment,
        distance: Math.sqrt(distanceSquaredToSegment(point, segment.start, segment.end)),
      }))
      .sort((a, b) => a.distance - b.distance);
    const influences = [];
    const usedBones = new Set();

    for (const candidate of rankedSegments) {
      if (usedBones.has(candidate.segment.boneIndex)) continue;
      usedBones.add(candidate.segment.boneIndex);
      influences.push({
        ...candidate,
        weight: 1 / Math.pow(candidate.distance + 0.24, 3),
      });
      if (influences.length === 4) break;
    }

    const totalWeight = influences.reduce((total, influence) => total + influence.weight, 0);
    influences.forEach((influence, influenceIndex) => {
      const targetIndex = vertexIndex * 4 + influenceIndex;
      joints[targetIndex] = influence.segment.boneIndex;
      weights[targetIndex] = influence.weight / totalWeight;
      if (influenceIndex === 0) {
        boneUse.set(
          influence.segment.boneName,
          (boneUse.get(influence.segment.boneName) || 0) + 1,
        );
      }
    });
  }

  return { joints, weights, boneUse };
}

function appendAlignedBuffer(binary, typedArray) {
  const start = align4(binary.length);
  const padding = Buffer.alloc(start - binary.length);
  const data = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  return { binary: Buffer.concat([binary, padding, data]), byteOffset: start, byteLength: data.length };
}

function writeGlb(json, binary, destination) {
  const paddedBinaryLength = align4(binary.length);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc(paddedBinaryLength - binary.length)]);
  json.buffers[0].byteLength = binary.length;

  const jsonData = Buffer.from(JSON.stringify(json), 'utf8');
  const paddedJsonLength = align4(jsonData.length);
  const paddedJson = Buffer.concat([jsonData, Buffer.alloc(paddedJsonLength - jsonData.length, 0x20)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBinary.length, 0);
  binHeader.writeUInt32LE(BIN_CHUNK, 4);

  fs.writeFileSync(destination, Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBinary]));
}

const { json, binary: sourceBinary } = parseGlb(fs.readFileSync(inputPath));
const skinIndex = 0;
const skin = json.skins?.[skinIndex];
if (!skin) throw new Error('No skin definition found in source GLB.');

const meshNodeIndex = json.nodes.findIndex((node) => node.mesh === 0);
if (meshNodeIndex < 0) throw new Error('Primary hand mesh node was not found.');
const primitive = json.meshes[json.nodes[meshNodeIndex].mesh].primitives[0];
const positions = readPositionAccessor(json, sourceBinary, primitive.attributes.POSITION);
const worldMatrices = buildWorldMatrices(json.nodes);
const segments = buildBoneSegments(json, skin, worldMatrices);
const { joints, weights, boneUse } = buildSmoothSkinAttributes(
  positions,
  worldMatrices[meshNodeIndex],
  segments,
);

let binary = sourceBinary;
const jointData = appendAlignedBuffer(binary, joints);
binary = jointData.binary;
const jointBufferView = json.bufferViews.push({
  buffer: 0,
  byteOffset: jointData.byteOffset,
  byteLength: jointData.byteLength,
  target: 34962,
}) - 1;
const jointAccessor = json.accessors.push({
  bufferView: jointBufferView,
  byteOffset: 0,
  componentType: 5123,
  count: positions.length / 3,
  type: 'VEC4',
}) - 1;

const weightData = appendAlignedBuffer(binary, weights);
binary = weightData.binary;
const weightBufferView = json.bufferViews.push({
  buffer: 0,
  byteOffset: weightData.byteOffset,
  byteLength: weightData.byteLength,
  target: 34962,
}) - 1;
const weightAccessor = json.accessors.push({
  bufferView: weightBufferView,
  byteOffset: 0,
  componentType: 5126,
  count: positions.length / 3,
  type: 'VEC4',
}) - 1;

primitive.attributes.JOINTS_0 = jointAccessor;
primitive.attributes.WEIGHTS_0 = weightAccessor;
json.nodes[meshNodeIndex].skin = skinIndex;
json.asset.generator = `${json.asset.generator || 'unknown'} + shroomLab smooth skin builder`;
writeGlb(json, binary, outputPath);

console.log(`Created ${path.relative(process.cwd(), outputPath)}`);
console.log(`Vertices: ${positions.length / 3}; joints used: ${boneUse.size}; bone segments: ${segments.length}`);
console.log([...boneUse.entries()].map(([name, count]) => `${name}:${count}`).join(', '));
