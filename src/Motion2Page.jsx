import React from 'react';
import GloveMotionPage from './GloveMotionPage.jsx';
import motion2ModelUrl from '../json/hand1_wrist_cut_cyan_rigged_wireframe.glb';
import motion2RegionData from '../json/hand1_wrist_cut_wire_regions.json';

const MOTION2_REGION_OPTIONS = Object.freeze({
  distributionParts: ['tip', 'palm_square'],
  pressureMapping: 'new147TipPalm',
});

export default function Motion2Page({ onNavigate }) {
  return (
    <GloveMotionPage
      onNavigate={onNavigate}
      pageKey="motion2"
      eyebrow="Motion2"
      title="Tip + Palm Regions"
      regionDataSource={motion2RegionData}
      regionColorOptions={MOTION2_REGION_OPTIONS}
      regionLabel="tip/palm lines"
      modelUrl={motion2ModelUrl}
      modelLabel="json/hand1_wrist_cut_cyan_rigged_wireframe.glb / json/hand1_wrist_cut_wire_regions.json"
      enableWujiBridgeByDefault
    />
  );
}
