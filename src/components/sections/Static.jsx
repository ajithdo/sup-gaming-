// Mostly-static marketing sections.
import { forwardRef, useRef, useState } from 'react';
import Icon from '../Icon';
import { CONTACT, FEATURES, FOOD_PHOTO, GAMES, GENRES, GENRE_COLOR, MENU, PASSES, QUOTES, C } from '../../config/site';
import { waLink } from '../../lib/links';

export function Experience() {
  return (
    <section id="experience" className="nl-section" data-screen-label="02 Experience">
      <div className="nl-panel">
        <div className="nl-panel__head">
          <span className="nl-eyebrow">THE EXPERIENCE</span>
          <h2 className="nl-h2 nl-h2--xl">BUILT FOR SERIOUS GAMERS</h2>
          <p>Every detail engineered for next-gen gaming. Premium. Private. Uninterrupted.</p>
        </div>
        <div className="nl-features">
          {FEATURES.map(f => (
            <div key={f.title} className="nl-feature" style={{ '--c': f.color }}>
              <Icon name={f.icon} className="nl-feature__icon" />
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export const Claim = forwardRef(function Claim({ onBook }, slotRef) {
  return (
    <section className="nl-claim" data-screen-label="04 Claim">
      <div ref={slotRef} className="nl-claim__slot" />
      <h2>CLAIM YOUR <span>POD</span></h2>
      <a href="#booking" className="nl-btn nl-btn--primary" onClick={onBook}>BOOK A POD</a>
    </section>
  );
});

const tileColor = g => GENRE_COLOR[g.genre] || C.cyan;

export function Games() {
  const [all, setAll] = useState(false);
  const [genre, setGenre] = useState('All');
  const sectionRef = useRef(null);

  const list = !all ? GAMES.slice(0, 4) : GAMES.filter(g => genre === 'All'
    || (genre === 'VR' ? g.platform === 'VR' : g.genre === genre || (genre === 'Racing' && g.genre === 'Sim Racing')));

  const toggle = () => {
    setAll(!all);
    setGenre('All');
    if (all && sectionRef.current) {
      const top = sectionRef.current.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <section id="games" ref={sectionRef} className="nl-section" data-screen-label="06 Games">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        <div className="nl-eyebrow"><span className="nl-eyebrow__dot" />GAME LIBRARY</div>
        <h2 className="nl-h2" style={{ margin: 0 }}>PLAY WHAT YOU LOVE</h2>
        <p className="nl-lead">Massive library of PS5 titles. Request any game when booking.</p>
      </div>
      {all && (
        <div className="nl-genres">
          {GENRES.map(g => (
            <button key={g} type="button" className={`nl-genre ${genre === g ? 'is-on' : ''}`} onClick={() => setGenre(g)}>{g}</button>
          ))}
        </div>
      )}
      <div className="nl-games">
        {list.map(g => (
          <div key={g.title} className="nl-game" style={{ '--c': tileColor(g) }}>
            <div className="nl-game__top"><span>{g.platform}</span><span>{g.players}</span></div>
            <div className="nl-game__art">{g.art}</div>
            <div className="nl-game__meta"><b>{g.title}</b><span><span>{g.genre}</span><i>{g.online}</i></span></div>
          </div>
        ))}
      </div>
      <div className="nl-games__more">
        <button type="button" onClick={toggle}>
          <Icon name={all ? 'expand_less' : 'grid_view'} /><span>{all ? 'SHOW LESS' : 'EXPLORE OUR LIBRARY'}</span>
        </button>
      </div>
      <a className="nl-request" href={waLink("Hi NextLevel! Can you add this game for my session: ")} target="_blank" rel="noopener noreferrer">
        <Icon name="sports_esports" />Don&apos;t see your game? Request it →
      </a>
    </section>
  );
}

export function Food() {
  return (
    <section id="food" className="nl-section" data-screen-label="07 Food">
      <div className="nl-food">
        <div className="nl-food__copy">
          <div className="nl-eyebrow" style={{ color: C.orange }}><Icon name="restaurant" size={18} />FOOD &amp; DRINKS</div>
          <h2 className="nl-h2" style={{ margin: 0 }}>EAT WHILE YOU PLAY.</h2>
          <p>Burgers, pizzas, loaded fries, cold coffee and shakes — served straight to your gaming room by our official food partner <b>OUR FOOD</b>. Daily 12 PM – 11 PM.</p>
          <div className="nl-menu">
            {MENU.map(m => <div key={m.name} style={{ '--c': m.color }}><Icon name={m.icon} /><b>{m.name}</b></div>)}
          </div>
          <div className="nl-mono" style={{ fontSize: 12, color: 'var(--t4)' }}>Add food while booking — we&apos;ll call to confirm your order.</div>
        </div>
        <div className="nl-food__photo">
          <img alt="Burger and cold brew" src={FOOD_PHOTO} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
          <div className="nl-food__tag"><span>BY US</span><span>SERVED TO YOUR ROOM</span></div>
        </div>
      </div>
    </section>
  );
}

export function Passes() {
  return (
    <section id="passes" className="nl-section" data-screen-label="08 Passes">
      <div className="nl-center-head">
        <span className="nl-eyebrow" style={{ color: C.orange }}>GAMING PASSES</span>
        <h2 className="nl-h2 nl-h2--xl" style={{ textTransform: 'none' }}>PLAY MORE. PAY LESS.</h2>
        <p className="nl-lead">Prepaid gaming hours at locked-in lower rates. Open Gaming, Private Rooms, Racing Sim — plus Student &amp; Founder passes.</p>
      </div>
      <div className="nl-passes">
        {PASSES.map(p => (
          <div key={p.name} className={`nl-pass ${p.featured ? 'is-featured' : ''}`} style={{ '--c': p.accent }}>
            {p.badge && <div className="nl-pass__badge">{p.badge}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="nl-pass__tier">{p.tier}</span>
              <h3>{p.name}</h3>
              <div className="nl-pass__price"><small>from </small><b>{p.price}</b><small> {p.unit}</small></div>
              <div className="nl-pass__feats">{p.feats.map(f => <div key={f}>{f}</div>)}</div>
            </div>
            <a className="nl-pass__cta" href={waLink(`Hi NextLevel! I'd like to buy a ${p.name} gaming pass. What are the options?`)} target="_blank" rel="noopener noreferrer">{p.cta}</a>
          </div>
        ))}
      </div>
      <div className="nl-footnote">Student Pass available · Limited Founder Passes · All passes valid 30 days</div>
    </section>
  );
}

export function Testimonials() {
  const items = [...QUOTES, ...QUOTES];
  return (
    <section className="nl-marquee" data-screen-label="11 Testimonials">
      <div className="nl-marquee__title">★★★★★ 5.0 ON GOOGLE · 27 REVIEWS</div>
      <div className="nl-marquee__track">
        {items.map((q, i) => (
          <div key={i} className="nl-marquee__item" aria-hidden={i >= QUOTES.length}>
            <b style={{ color: q.color }}>{q.name}</b><span>{q.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Contact() {
  return (
    <section id="contact" className="nl-section" data-screen-label="12 Contact">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        <span className="nl-eyebrow">FIND US</span>
        <h2 className="nl-h2" style={{ margin: 0 }}>VISIT NEXTLEVEL GAMING ZONE</h2>
      </div>
      <div className="nl-contact">
        <div className="nl-contact__list">
          <a className="nl-contact__card" href={CONTACT.phoneHref} style={{ '--c': C.emerald }}>
            <img alt="" src="/assets/icon_phone.jpg" /><span><small>CALL / WHATSAPP</small><strong>{CONTACT.phoneDisplay}</strong></span>
          </a>
          <a className="nl-contact__card" href={'mailto:' + CONTACT.email} style={{ '--c': C.cyan }}>
            <img alt="" src="/assets/icon_mail.jpg" /><span><small>EMAIL</small><strong>{CONTACT.email}</strong></span>
          </a>
          <a className="nl-contact__card" href={'https://instagram.com/' + CONTACT.instagramHandle} target="_blank" rel="noopener noreferrer" style={{ '--c': C.violet }}>
            <img alt="" src="/assets/icon_instagram.jpg" /><span><small>INSTAGRAM</small><strong>@{CONTACT.instagramHandle}</strong></span>
          </a>
          <a className="nl-contact__card" href={CONTACT.mapsLink} target="_blank" rel="noopener noreferrer" style={{ '--c': C.crimson }}>
            <img alt="" src="/assets/icon_pin.png" className="is-contain" /><span><small>ADDRESS · GET DIRECTIONS</small><strong className="is-address">{CONTACT.address}</strong></span>
          </a>
          <div className="nl-hours"><span>{CONTACT.days}</span><span>{CONTACT.hours}</span></div>
        </div>
        <div className="nl-map">
          <iframe title="NextLevel Gaming zone map" src={CONTACT.mapsEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ onBook }) {
  return (
    <>
      <section className="nl-section nl-final" data-screen-label="13 CTA">
        <div className="nl-final__panel">
          <span className="nl-eyebrow">ELEVATE YOUR GAMEPLAY</span>
          <h2>READY TO LEVEL UP?</h2>
          <div className="nl-final__ctas">
            <a href="#booking" className="nl-btn nl-btn--primary" onClick={onBook}><Icon name="rocket_launch" /><span>BOOK A SLOT</span></a>
            <a href={'https://wa.me/' + CONTACT.whatsapp} className="nl-wa-cta" target="_blank" rel="noopener noreferrer"><Icon name="chat" size={24} /><span>WHATSAPP US</span></a>
          </div>
        </div>
      </section>
      <footer className="nl-footer">
        <div className="nl-footer__top">
          <img alt="NEXT LEVEL Gaming Zone" src="/assets/new_logo.png" loading="lazy" />
          <div className="nl-footer__links">
            <a href="#rooms">Rooms</a><a href="#passes">Passes</a><a href="#booking">Book</a><a href="#my-bookings">My Bookings</a>
            <a href={'https://instagram.com/' + CONTACT.instagramHandle} target="_blank" rel="noopener noreferrer">Instagram</a>
          </div>
        </div>
        <div className="nl-footer__legal">© 2026 NextLevel Gaming zone · Hanamkonda · All Rights Reserved</div>
      </footer>
    </>
  );
}
