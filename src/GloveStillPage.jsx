import React from 'react';
import GloveMotionPage from './GloveMotionPage.jsx';

export default function GloveStillPage({ onNavigate }) {
  return (
    <GloveMotionPage
      onNavigate={onNavigate}
      pageKey="gloveStill"
      eyebrow="Glove Still"
      title="Fixed Orientation + Finger Bend"
      lockOrientation
    />
  );
}
