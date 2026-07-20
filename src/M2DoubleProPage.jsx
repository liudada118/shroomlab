import React from 'react';
import GloveMotionPage from './GloveMotionPage.jsx';
import motion2ModelUrl from '../json/hand1_wrist_cut_cyan_rigged_wireframe.glb';
import motion2RegionData from '../json/hand1_wrist_cut_wire_regions.json';
import poseCalibrationData from '../json/motion2double-gyro-pose-averages.json';

const M2DOUBLE_PRO_REGION_OPTIONS = Object.freeze({
  distributionParts: ['tip', 'palm_square'],
  pressureMapping: 'new147TipPalm',
});

const M2DOUBLE_PRO_WUJI_BRIDGE_URLS = Object.freeze({
  left: 'ws://127.0.0.1:8765/ws',
  right: 'ws://127.0.0.1:8766/ws',
});

const M2DOUBLE_PRO_HAND_VIEWS = Object.freeze([
  Object.freeze({ key: 'left', side: 'left', x: -2.05, y: 0.25, scale: 0.56, modelScaleX: -1, phase: 0.42 }),
  Object.freeze({ key: 'right', side: 'right', x: 2.05, y: 0.25, scale: 0.56, modelScaleX: 1, phase: 0 }),
]);

const M2DOUBLE_PRO_LIVE_QUATERNION_AXIS_SIGNS = Object.freeze({
  left: Object.freeze({ z: -1 }),
});

const M2DOUBLE_PRO_MODEL_TRANSFORMS = Object.freeze({
  left: Object.freeze({
    x: 0,
    y: -1.6,
    z: 0,
    rotX: -360,
    rotY: -180,
    rotZ: -90,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    scale: 1,
  }),
  right: Object.freeze({
    x: 0,
    y: -1.6,
    z: 0,
    rotX: -180,
    rotY: -360,
    rotZ: -270,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    scale: 1,
  }),
});

export default function M2DoubleProPage({ onNavigate }) {
  return (
    <GloveMotionPage
      onNavigate={onNavigate}
      pageKey="m2doublePro"
      eyebrow="M2Double Pro"
      title="Quaternion Pose + Finger Motion"
      regionDataSource={motion2RegionData}
      regionColorOptions={M2DOUBLE_PRO_REGION_OPTIONS}
      regionLabel="tip/palm lines"
      modelUrl={motion2ModelUrl}
      modelLabel="Left 89 samples / Right 83 samples"
      handViews={M2DOUBLE_PRO_HAND_VIEWS}
      modelTransformDefaults={M2DOUBLE_PRO_MODEL_TRANSFORMS}
      resetStoredModelTransforms
      initialHandSide="left"
      showLiveHandToggle={false}
      poseCalibrationData={poseCalibrationData}
      initialPoseInputMode="poses"
      liveQuaternionAxisSigns={M2DOUBLE_PRO_LIVE_QUATERNION_AXIS_SIGNS}
      enableWujiBridgeByDefault
      wujiBridgeUrls={M2DOUBLE_PRO_WUJI_BRIDGE_URLS}
    />
  );
}
