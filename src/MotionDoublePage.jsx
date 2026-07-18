import React from 'react';
import GloveMotionPage from './GloveMotionPage.jsx';

const MOTION_DOUBLE_HAND_VIEWS = Object.freeze([
  Object.freeze({ key: 'left', side: 'left', x: -2.35, y: 0.25, scale: 0.56, modelScaleX: -1, phase: 0.42 }),
  Object.freeze({ key: 'right', side: 'right', x: 1.75, y: 0.25, scale: 0.56, modelScaleX: 1, phase: 0 }),
]);

export default function MotionDoublePage({ onNavigate }) {
  return (
    <GloveMotionPage
      onNavigate={onNavigate}
      pageKey="motiondouble"
      eyebrow="MotionDouble"
      title="Left + Right Hands"
      modelLabel="/model/hand1_wrist_cut_cyan_rigged_wireframe.glb / left X scale -1 + right X scale 1"
      handViews={MOTION_DOUBLE_HAND_VIEWS}
      initialHandSide="left"
    />
  );
}
