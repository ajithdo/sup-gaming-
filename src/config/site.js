// Site content and business details — edit here, not in the components.
// Prices and bookability of rooms come from the database (public.rooms);
// the values below are only the visual details and fallbacks.

export const C = {
  cyan: '#00E5FF', orange: '#FF6B1A', violet: '#7B5CFF', emerald: '#10B981', crimson: '#EF4444', amber: '#FFAA2A',
};

// ⚠️ Confirm these with the owner. The design showed different text than its links;
// both the visible text and the links now come from these values.
export const CONTACT = {
  whatsapp: '919381487875',                 // international format, no "+"
  phoneDisplay: '+91 93814 87875',
  phoneHref: 'tel:+919381487875',
  email: 'phaninderreddy279@gmail.com',
  instagramHandle: 'phaninderreddy.in',
  address: 'Kishanpura, beside orugallu, kababs, Naim Nagar, Hanamkonda, Telangana 506001',
  mapsLink: 'https://www.google.com/maps/place/?q=place_id:ChIJzRzYCQVPMzoRztr9FUO6roY',
  mapsEmbed: 'https://maps.google.com/maps?q=Kishanpura%2C%20Naim%20Nagar%2C%20Hanamkonda%2C%20Telangana%20506001&z=15&output=embed',
  hours: '12:00 PM – 11:00 PM',
  days: 'MONDAY – SUNDAY',
};

export const VENUE = {
  timezone: 'Asia/Kolkata',
  openHour: 12,
  lastStartHour: 23,
  closeHour: 24,            // sessions must end by midnight
  maxDuration: 4,
  windowDays: 7,
  graceMinutes: 15,
};

const IMG = 'https://lh3.googleusercontent.com/aida-public/';

export const FEATURES = [
  { icon: 'sports_esports', title: 'PS5 Console', desc: 'PS5 console with full game library in your private room.', color: C.cyan },
  { icon: 'tv', title: '4K Display', desc: 'Crystal clear visuals every session.', color: C.orange },
  { icon: 'savings', title: 'Experience Gaming at Low Prices', desc: 'Premium PS5 gaming at the most affordable rates in town.', color: C.emerald },
  { icon: 'ac_unit', title: 'AC Rooms', desc: 'Cool, comfortable environment all year.', color: C.violet },
];

// Visual details per room id. Name / subtitle / state / rates are loaded from the DB.
export const ROOM_META = {
  pr1: { icon: 'sports_esports', color: C.cyan, unit: 'per hour', img: IMG + 'AB6AXuBtdzSo1-BjpZkDtDwq_cUx1eiqiGQknptoNb8o6M_tdCrkllcod-cyPYu5Pi5GrZS77vcAWe3SZJqfmvuwtZDhgtykhGsSH1XDjFBT7zGsOt81fNWRa6ffGKEIu3vVt7I2xwIH_FazqFNi6ZaQ611al8dWfkWOmjrh72BChObOcu13mKBHZBiZYaix6t0FQi-2wX_xP-EvS439dBs6CkmbzGMJQMgxIZBCVvCXnhsNR1Daow22DewZSg' },
  pr2: { icon: 'sports_esports', color: C.cyan, unit: 'per hour', img: IMG + 'AB6AXuASJtZMf93XfNrf4rS5GhMMyDx5Z0SsDPFUmj8fM1SwcLMopDsN2rUrhJaXy1FBuFjdIxpYHnZo5LgdcmJ2VOcokWyPRdCyz7y8YIwElZXBtYNjf3oBKvjfg5E1LD0FqHkdzgUVLcR_I8bUlSG6xFxQbrVbXM7ko9vKnshQp8ovU1Rf9NqT_NzWGfcy5JYP8jgKXLIgt6cOUzf011qfOeE_3QnzLv_W2gZ1SEOtx2SStQ9__XmnzDxbYw' },
  race: { icon: 'directions_car', color: C.orange, unit: 'per hour', img: IMG + 'AB6AXuD7uz0NnVg8DzHmcnwm5w5yQ7s6aLNxkJJlKHYT2-Sw7aw2mbHh3bkWudYpOma9GbS2sR1WhISmOUOXbhECbJcykc4yG4NxWxkfFQMoxNx1C30TZOiJeDJUW-F3W7ARPwVw-aw1ReKL9jEty4UxZjSOPkW05-mqjPU45HwCtWYWhGaaSih1mOLVOKePUJaPXqY5XvfE57m3AzZlirnnIEyVMtZHIK4rEGnuEvRFqS_RmdqNDIDsA7lacw' },
  vr: { icon: 'view_in_ar', color: C.violet, unit: '15 min trial' },
  open: { icon: 'groups', color: C.emerald, unit: 'per player/hr' },
};

// Used until the rooms table has loaded (and if Supabase isn't configured yet).
export const FALLBACK_ROOMS = [
  { id: 'pr1', name: 'Private Room 1', subtitle: 'PS5 · Your Own Private Room · 4K · Recliner', state: 'book', rates: [199, 299, 399, 499], sort_order: 1 },
  { id: 'pr2', name: 'Private Room 2', subtitle: 'PS5 · Your Own Private Room · 4K · Recliner', state: 'book', rates: [199, 299, 399, 499], sort_order: 2 },
  { id: 'race', name: 'Racing Wheel', subtitle: 'Logitech G29 · Force Feedback · Pedals', state: 'book', rates: [199], sort_order: 3 },
  { id: 'vr', name: 'VR Room', subtitle: 'PlayStation VR2 · 50+ VR Titles', state: 'soon', rates: [99], sort_order: 4 },
  { id: 'open', name: 'Open Room', subtitle: 'PS5 Slim × 2 · Shared Space', state: 'walkin', rates: [99], sort_order: 5 },
];

export const PLAYER_LABELS = ['Solo', 'Duo', 'Trio', 'Squad', '5P', '6P', '7P', '8P'];

export const GAMES = [
  ['PS5', '1-4P', 'FC 26', 'EA Sports FC 26', 'Football', 1], ['PS5', '1-4P', 'W2K 26', 'WWE 2K26', 'Wrestling', 1], ['PS5', '1-4P', 'CRICKET\n24', 'Cricket 24', 'Sports', 1],
  ['PS5', '1-2P', 'TEKKEN\n8', 'Tekken 8', 'Fighting', 1], ['PS5', '1-2P', 'MORTAL\nKOMBAT', 'Mortal Kombat 1', 'Fighting', 1], ['PS5', '1-2P', 'CALL OF\nDUTY', 'Call of Duty BO6', 'FPS', 1],
  ['PS5', '1-2P', 'GRAN\nTURISMO 7', 'Gran Turismo 7', 'Racing', 1], ['PS5', '1-2P', 'F1\n25', 'F1 2025', 'Racing', 1], ['PS5', '1-4P', 'ASPHALT\nLEGENDS', 'Asphalt Legends', 'Racing', 1],
  ['PS5', '1P', 'SPIDER\nMAN 2', 'Spider-Man 2', 'Action', 0], ['PS5', '1P', 'GTA V', 'GTA V', 'Open World', 1], ['PS5', '1P', 'RED DEAD\nREDEMPTION II', 'Red Dead 2', 'Open World', 1],
  ['PS5', '1P', 'UNCHARTED', 'Uncharted 4', 'Adventure', 0], ['PS5', '1P', 'THE CREW\nMOTORFEST', 'The Crew Motorfest', 'Racing', 1], ['WHEEL', '1P', 'ASSETTO\nCORSA', 'Assetto Corsa', 'Sim Racing', 0],
  ['VR', '1P', 'BEAT\nSABER', 'Beat Saber', 'Rhythm', 0], ['VR', '1P', 'IB\nCRICKET', 'iB Cricket', 'Sports', 0],
].map(([platform, players, art, title, genre, online]) => ({ platform, players: '👤 ' + players, art, title, genre, online: online ? '● Online' : '' }));

export const GENRE_COLOR = {
  Football: C.emerald, Wrestling: C.crimson, Sports: C.emerald, Fighting: C.orange, FPS: C.crimson, Racing: C.cyan,
  'Sim Racing': C.cyan, Action: C.violet, 'Open World': C.amber, Adventure: C.amber, Rhythm: C.violet,
};
export const GENRES = ['All', 'Racing', 'Fighting', 'Sports', 'Open World', 'FPS', 'Action', 'VR'];

// Names must match venue_settings.food_options in the database.
export const MENU = [
  { icon: 'lunch_dining', name: 'Burgers', color: C.orange },
  { icon: 'local_pizza', name: 'Pizzas', color: C.amber },
  { icon: 'ramen_dining', name: 'Pasta', color: C.amber },
  { icon: 'fastfood', name: 'Loaded Fries', color: C.orange },
  { icon: 'coffee', name: 'Cold Coffee', color: C.cyan },
  { icon: 'local_bar', name: 'Shakes & Mocktails', color: C.violet },
];

export const PASSES = [
  { tier: 'OPEN GAMING', name: 'Open Gaming', price: '₹80', unit: '/hr', accent: C.emerald, feats: ['10 / 20 / 30 hrs', 'Open PS5 stations', 'Valid 30 days'], cta: 'GET OPEN PASS' },
  { tier: 'PRIVATE ROOM', name: 'Private Room', price: '₹175', unit: '/hr', accent: C.cyan, badge: 'MOST POPULAR', featured: true, feats: ['Solo · Duo · Trio · Squad', 'Your own private room', 'Valid 30 days'], cta: 'GET ROOM PASS' },
  { tier: 'RACING SIM', name: 'Racing Sim', price: '₹180', unit: '/hr', accent: C.orange, feats: ['5 / 10 / 20 hrs', 'Logitech G29 wheel', 'Valid 30 days'], cta: 'GET RACING PASS' },
];

// ⚠️ Placeholder quotes from the design — replace with real Google reviews.
export const QUOTES = [
  { name: 'GODLIKE_HYDRA:', color: C.orange, text: '"The racing wheel setup with GT7 is unreal."' },
  { name: 'HYPER_REIGN:', color: C.cyan, text: '"Private room, 4K screen, zero distractions — perfect for our squad."' },
  { name: 'KISHAN_K:', color: C.violet, text: '"Best gaming lounge in Hanamkonda. Food delivered straight to the room."' },
  { name: 'VALORANT_PROS:', color: C.emerald, text: '"Great prices for this quality. We keep coming back."' },
];

export const FOOD_PHOTO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuCcJ4OnQ5ePEU5yJLV-oV5TgOzFFUvmJeJYQlhvosl5ldi7utr7-xeAJ34Ax28Z7v4NkVDEzkeO8Elan0_CVgDjckt9JjV2QsVic1uZxIm0_9ITtKJDUTX_7YWot28onlbybcaCS4X2QSNR7wRAvn2nLBWp1c-wH2DMSDHMfmMc88eQ5eYY1GgIQZh8saKA0sMEEE02-vprJqWhttGTnySY1ocpyJwHzAJ_IWHs7y61N2Igi_MBeLMnUA';
