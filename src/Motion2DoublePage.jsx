import React from 'react';
import GloveMotionPage from './GloveMotionPage.jsx';
import motion2ModelUrl from '../json/hand1_wrist_cut_cyan_rigged_wireframe.glb';
import motion2RegionData from '../json/hand1_wrist_cut_wire_regions.json';

const MOTION2_DOUBLE_REGION_OPTIONS = Object.freeze({
  distributionParts: ['tip', 'palm_square'],
  pressureMapping: 'new147TipPalm',
});

const MOTION2_DOUBLE_HAND_VIEWS = Object.freeze([
  Object.freeze({ key: 'left', side: 'left', x: -2.05, y: 0.25, scale: 0.56, modelScaleX: -1, phase: 0.42 }),
  Object.freeze({ key: 'right', side: 'right', x: 2.05, y: 0.25, scale: 0.56, modelScaleX: 1, phase: 0 }),
]);

const MOTION2_DOUBLE_MODEL_TRANSFORM_DEFAULTS = Object.freeze({
  left: Object.freeze({
    x: -2.9,
    y: -1.4,
    z: 0,
    rotX: -360,
    rotY: -169,
    rotZ: -127,
    pivotX: -1.06,
    pivotY: 0,
    pivotZ: 0,
    scale: 1,
  }),
  right: Object.freeze({
    x: 0.55,
    y: -2.1,
    z: 0,
    rotX: -183,
    rotY: -360,
    rotZ: -313,
    pivotX: 0.02,
    pivotY: 0,
    pivotZ: 0,
    scale: 1,
  }),
});

export default function Motion2DoublePage({ onNavigate }) {
  return (
    <GloveMotionPage
      onNavigate={onNavigate}
      pageKey="motion2double"
      eyebrow="Motion2Double"
      title="Left + Right Hands"
      regionDataSource={motion2RegionData}
      regionColorOptions={MOTION2_DOUBLE_REGION_OPTIONS}
      regionLabel="tip/palm lines"
      modelUrl={motion2ModelUrl}
      modelLabel="json/hand1_wrist_cut_cyan_rigged_wireframe.glb / left X scale -1 + right X scale 1"
      handViews={MOTION2_DOUBLE_HAND_VIEWS}
      modelTransformDefaults={MOTION2_DOUBLE_MODEL_TRANSFORM_DEFAULTS}
      initialHandSide="left"
      showLiveHandToggle={false}
    />
  );
}
