import { forwardRef } from 'react';
import Icon from '../Icon';

const Hero = forwardRef(function Hero({ slotRef, live, scene, onBook }, ref) {
  return (
    <section ref={ref} className="nl-hero" data-screen-label="01 Hero">
      <div className="nl-hero__inner">
        {/* On phones the controller floats in this empty slot above the text */}
        <div ref={slotRef} className="nl-hero__slot" />
        <div className="nl-hero__col">
          <div className="nl-badge">
            <span className="nl-ping nl-ping--lg" />
            <span>NOW OPEN IN <b>HANAMKONDA</b></span>
          </div>
          <h1>NEXT-GEN CYBER<span className="nl-hero__sweep">SANCTUARY</span></h1>
          <p className="nl-hero__p">
            Premium Gaming Experience. PS5 · VR · Racing Sim · Private Rooms. Every detail engineered for next-gen gaming. Premium. Private. Uninterrupted.
          </p>
          <div className="nl-stats">
            <div className="nl-stat" style={{ '--stat-border': 'rgba(255,170,42,0.25)', '--stat-color': '#FFAA2A' }}>
              <span>GOOGLE</span><span>5.0 ★</span><span>27 reviews</span>
            </div>
            <div className="nl-stat" style={{ '--stat-border': 'rgba(0,229,255,0.25)', '--stat-color': '#00E5FF' }}>
              <span>PRIVATE ROOM</span><span>₹199</span><span>per hour</span>
            </div>
            <div className="nl-stat" style={{ '--stat-border': live.color + '4d', '--stat-color': live.color }}>
              <span>RIGHT NOW</span><span>{live.freeNow}</span><span>{live.freeNowSub}</span>
            </div>
          </div>
          <div className="nl-ctas">
            <a href="#booking" className="nl-btn nl-btn--primary" onClick={onBook}><Icon name="bolt" /><span>BOOK A SLOT</span></a>
            <a href="#games" className="nl-btn nl-btn--secondary"><Icon name="sports_esports" /><span>EXPLORE GAMES</span></a>
          </div>
          <div className="nl-hint">DRAG CONTROLLER TO SPIN · TAP A PLANET</div>
        </div>
      </div>
      <div className="nl-planet" style={{ opacity: scene.planet ? 1 : 0 }}>SCANNING: {scene.planetName}</div>
      {scene.loading && (
        <div className="nl-loader">
          <span>LOADING CONTROLLER {scene.pct}%</span>
          <div className="nl-loader__bar"><div style={{ width: scene.pct + '%' }} /></div>
        </div>
      )}
    </section>
  );
});

export default Hero;
