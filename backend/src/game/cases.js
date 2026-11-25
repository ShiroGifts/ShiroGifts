const CASES = [
  { id: 'farm', name: 'Фарм', price: 1, drops: [
    { type: 'gift', key: 'random_nft', weight: 1 },
    { type: 'nothing', weight: 999 }
  ]},
  { id: 'starter', name: 'Стартовый', price: 10, drops: [
    { type: 'gift', key: 'bear', weight: 20 }, { type: 'gift', key: 'heart', weight: 20 },
    { type: 'gift', key: 'rose', weight: 15 }, { type: 'stars', amount: 5, weight: 2 },
    { type: 'stars', amount: 10, weight: 1 }, { type: 'nothing', weight: 42 }
  ]},
  { id: 'mini', name: 'Мини', price: 25, drops: [
    { type: 'gift', key: 'bear', weight: 20 }, { type: 'gift', key: 'heart', weight: 18 },
    { type: 'gift', key: 'rose', weight: 18 }, { type: 'gift', key: 'cake', weight: 10 },
    { type: 'stars', amount: 10, weight: 20 }, { type: 'stars', amount: 25, weight: 10 },
    { type: 'gift', key: 'bouquet', weight: 4 }
  ]},
  { id: 'bronze', name: 'Бронзовый', price: 50, drops: [
    { type: 'gift', key: 'bear', weight: 28 }, { type: 'gift', key: 'heart', weight: 22 },
    { type: 'gift', key: 'rose', weight: 18 }, { type: 'gift', key: 'cake', weight: 10 },
    { type: 'gift', key: 'bouquet', weight: 5 }, { type: 'gift', key: 'rocket', weight: 4 },
    { type: 'stars', amount: 10, weight: 8 }, { type: 'stars', amount: 25, weight: 4 },
    { type: 'stars', amount: 50, weight: 1 }
  ]},
  { id: 'silver', name: 'Серебряный', price: 75, drops: [
    { type: 'gift', key: 'rose', weight: 19 }, { type: 'gift', key: 'cake', weight: 17 },
    { type: 'gift', key: 'bouquet', weight: 14 }, { type: 'gift', key: 'rocket', weight: 12 },
    { type: 'gift', key: 'champ', weight: 10 }, { type: 'gift', key: 'cup', weight: 7 },
    { type: 'gift', key: 'ring', weight: 5 }, { type: 'stars', amount: 15, weight: 9 },
    { type: 'stars', amount: 35, weight: 5 }, { type: 'stars', amount: 75, weight: 2 }
  ]},
  { id: 'gold', name: 'Золотой', price: 120, drops: [
    { type: 'gift', key: 'cake', weight: 14 }, { type: 'gift', key: 'bouquet', weight: 13 },
    { type: 'gift', key: 'rocket', weight: 12 }, { type: 'gift', key: 'champ', weight: 12 },
    { type: 'gift', key: 'cup', weight: 11 }, { type: 'gift', key: 'ring', weight: 9 },
    { type: 'gift', key: 'diamond', weight: 6 }, { type: 'stars', amount: 25, weight: 11 },
    { type: 'stars', amount: 60, weight: 7 }, { type: 'stars', amount: 120, weight: 5 }
  ]},
  { id: 'legend', name: 'Легендарный', price: 200, drops: [
    { type: 'gift', key: 'cup', weight: 15 }, { type: 'gift', key: 'ring', weight: 14 },
    { type: 'gift', key: 'diamond', weight: 14 }, { type: 'gift', key: 'rocket', weight: 8 },
    { type: 'gift', key: 'champ', weight: 8 }, { type: 'gift', key: 'random_nft', weight: 3 },
    { type: 'stars', amount: 50, weight: 14 }, { type: 'stars', amount: 100, weight: 10 },
    { type: 'stars', amount: 200, weight: 9 }, { type: 'stars', amount: 500, weight: 5 }
  ]},
  { id: 'ruby', name: 'Рубиновый', price: 300, drops: [
    { type: 'gift', key: 'bouquet', weight: 8 }, { type: 'gift', key: 'champ', weight: 10 },
    { type: 'gift', key: 'cup', weight: 13 }, { type: 'gift', key: 'ring', weight: 13 },
    { type: 'gift', key: 'diamond', weight: 14 }, { type: 'gift', key: 'random_nft', weight: 5 },
    { type: 'stars', amount: 75, weight: 13 }, { type: 'stars', amount: 150, weight: 10 },
    { type: 'stars', amount: 300, weight: 8 }, { type: 'stars', amount: 750, weight: 6 }
  ]},
  { id: 'diamond', name: 'Алмазный', price: 500, drops: [
    { type: 'gift', key: 'cup', weight: 8 }, { type: 'gift', key: 'ring', weight: 12 },
    { type: 'gift', key: 'diamond', weight: 16 }, { type: 'gift', key: 'random_nft', weight: 8 },
    { type: 'stars', amount: 100, weight: 14 }, { type: 'stars', amount: 250, weight: 14 },
    { type: 'stars', amount: 500, weight: 12 }, { type: 'stars', amount: 1000, weight: 10 },
    { type: 'stars', amount: 2500, weight: 6 }
  ]},
  { id: 'cosmic', name: 'Космический', price: 1000, drops: [
    { type: 'gift', key: 'ring', weight: 79920 }, { type: 'gift', key: 'diamond', weight: 149850 },
    { type: 'gift', key: 'random_nft', weight: 119880 }, { type: 'gift', key: 'plush_pepe_royal', weight: 1000 },
    { type: 'stars', amount: 200, weight: 119880 }, { type: 'stars', amount: 500, weight: 149850 },
    { type: 'stars', amount: 1000, weight: 149850 }, { type: 'stars', amount: 2000, weight: 129870 },
    { type: 'stars', amount: 5000, weight: 99900 }
  ]},
  { id: 'nft', name: 'НФТ', price: 750, drops: [
    { type: 'gift', key: 'plush_pepe', weight: 100 },
    { type: 'gift', key: 'diamond_ring', weight: 100 },
    { type: 'gift', key: 'durovs_glasses', weight: 100 },
    { type: 'gift', key: 'durovs_cap', weight: 100 },
    { type: 'gift', key: 'resistance_dog', weight: 100 },
    { type: 'gift', key: 'precious_peach', weight: 100 },
    { type: 'gift', key: 'scared_cat', weight: 100 },
    { type: 'gift', key: 'heroic_helmet', weight: 100 },
    { type: 'gift', key: 'astral_shard', weight: 100 },
    { type: 'gift', key: 'loot_bag', weight: 100 },
    { type: 'gift', key: 'vice_cream', weight: 68000 },
    { type: 'gift', key: 'lol_pop', weight: 68000 },
    { type: 'gift', key: 'bunny_muffin', weight: 68000 },
    { type: 'gift', key: 'jolly_chimp', weight: 68000 },
    { type: 'gift', key: 'ginger_cookie', weight: 68000 },
    { type: 'gift', key: 'chill_flame', weight: 68000 },
    { type: 'gift', key: 'mirage_lamp', weight: 68000 },
    { type: 'gift', key: 'snoop_dogg', weight: 68000 },
    { type: 'gift', key: 'bday_candle', weight: 2500 },
    { type: 'gift', key: 'desk_calendar', weight: 2500 },
    { type: 'gift', key: 'jelly_bunny', weight: 2500 },
    { type: 'gift', key: 'eternal_rose', weight: 2500 },
    { type: 'gift', key: 'genie_lamp', weight: 2500 },
    { type: 'gift', key: 'heart_locket', weight: 2500 },
    { type: 'gift', key: 'ion_gem', weight: 2500 },
    { type: 'gift', key: 'jack_in_the_box', weight: 2500 },
    { type: 'gift', key: 'jester_hat', weight: 2500 },
    { type: 'gift', key: 'joyful_bundle', weight: 2500 },
    { type: 'gift', key: 'kissed_frog', weight: 2500 },
    { type: 'gift', key: 'love_candle', weight: 2500 },
    { type: 'gift', key: 'magic_potion', weight: 2500 },
    { type: 'gift', key: 'mahjong_tile', weight: 2500 },
    { type: 'gift', key: 'mini_oscar', weight: 2500 },
    { type: 'gift', key: 'nail_bracelet', weight: 2500 },
    { type: 'gift', key: 'party_sparkler', weight: 2500 },
    { type: 'gift', key: 'perfume_bottle', weight: 2500 },
    { type: 'gift', key: 'pet_snake', weight: 2500 },
    { type: 'nothing', weight: 407500 }
  ]}
];

const GIFT_DATA = {
  bear: { name: 'Мишка', emoji: '🧸', rarity: 'Обычный', value: 15 },
  heart: { name: 'Сердце', emoji: '❤️', rarity: 'Обычный', value: 15 },
  rose: { name: 'Роза', emoji: '🌹', rarity: 'Обычный', value: 25 },
  cake: { name: 'Торт', emoji: '🎂', rarity: 'Редкий', value: 50 },
  bouquet: { name: 'Букет', emoji: '💐', rarity: 'Редкий', value: 50 },
  rocket: { name: 'Ракета', emoji: '🚀', rarity: 'Редкий', value: 50 },
  champ: { name: 'Шампанское', emoji: '🍾', rarity: 'Редкий', value: 50 },
  cup: { name: 'Кубок', emoji: '🏆', rarity: 'Эпический', value: 100 },
  ring: { name: 'Кольцо', emoji: '💍', rarity: 'Эпический', value: 100 },
  diamond: { name: 'Бриллиант', emoji: '💎', rarity: 'Легендарный', value: 100 },
  random_nft: { name: 'Рандомный NFT', emoji: '🎁', rarity: 'NFT', value: 350 },
  plush_pepe: { name: 'Plush Pepe NFT', emoji: '🐸', rarity: 'NFT · Мифический', value: 480702 },
  plush_pepe_royal: { name: 'Plush Pepe', emoji: '🐸', rarity: 'NFT · ДЖЕКПОТ', value: 480702 },
  diamond_ring: { name: 'Diamond Ring NFT', emoji: '💍', rarity: 'NFT', value: 2305 },
  durovs_glasses: { name: "Durov’s Glasses NFT", emoji: '🕶️', rarity: 'NFT', value: 11022 },
  durovs_cap: { name: "Durov’s Cap NFT", emoji: '🧢', rarity: 'NFT', value: 28590 },
  resistance_dog: { name: 'Resistance Dog NFT', emoji: '🐕', rarity: 'NFT', value: 35000 },
  precious_peach: { name: 'Precious Peach NFT', emoji: '🍑', rarity: 'NFT', value: 19572 },
  scared_cat: { name: 'Scared Cat NFT', emoji: '🐈', rarity: 'NFT', value: 19099 },
  heroic_helmet: { name: 'Heroic Helmet NFT', emoji: '🪖', rarity: 'NFT', value: 14629 },
  astral_shard: { name: 'Astral Shard NFT', emoji: '💠', rarity: 'NFT', value: 9819 },
  loot_bag: { name: 'Loot Bag NFT', emoji: '🎒', rarity: 'NFT', value: 10688 },
  vice_cream: { name: 'Vice Cream NFT', emoji: '🍦', rarity: 'NFT', value: 650 },
  lol_pop: { name: 'Lol Pop NFT', emoji: '🍭', rarity: 'NFT', value: 700 },
  bunny_muffin: { name: 'Bunny Muffin NFT', emoji: '🐰', rarity: 'NFT', value: 750 },
  jolly_chimp: { name: 'Jolly Chimp NFT', emoji: '🐵', rarity: 'NFT', value: 800 },
  ginger_cookie: { name: 'Ginger Cookie NFT', emoji: '🍪', rarity: 'NFT', value: 850 },
  chill_flame: { name: 'Chill Flame NFT', emoji: '🔥', rarity: 'NFT', value: 900 },
  mirage_lamp: { name: 'Mirage Lamp NFT', emoji: '🪔', rarity: 'NFT', value: 950 },
  snoop_dogg: { name: 'Snoop Dogg NFT', emoji: '🐶', rarity: 'NFT', value: 1000 },
  bday_candle: { name: 'B-Day Candle NFT', emoji: '🕯️', rarity: 'NFT · Средний', value: 1150 },
  desk_calendar: { name: 'Desk Calendar NFT', emoji: '🗓️', rarity: 'NFT · Средний', value: 1250 },
  jelly_bunny: { name: 'Jelly Bunny NFT', emoji: '🐰', rarity: 'NFT · Средний', value: 1350 },
  eternal_rose: { name: 'Eternal Rose NFT', emoji: '🌹', rarity: 'NFT · Средний', value: 1450 },
  genie_lamp: { name: 'Genie Lamp NFT', emoji: '🪔', rarity: 'NFT · Средний', value: 1550 },
  heart_locket: { name: 'Heart Locket NFT', emoji: '💗', rarity: 'NFT · Средний', value: 1650 },
  ion_gem: { name: 'Ion Gem NFT', emoji: '💠', rarity: 'NFT · Средний', value: 1750 },
  jack_in_the_box: { name: 'Jack-in-the-Box NFT', emoji: '🎁', rarity: 'NFT · Средний', value: 1850 },
  jester_hat: { name: 'Jester Hat NFT', emoji: '🤡', rarity: 'NFT · Средний', value: 1950 },
  joyful_bundle: { name: 'Joyful Bundle NFT', emoji: '🎀', rarity: 'NFT · Средний', value: 2050 },
  kissed_frog: { name: 'Kissed Frog NFT', emoji: '🐸', rarity: 'NFT · Средний', value: 2150 },
  love_candle: { name: 'Love Candle NFT', emoji: '🕯️', rarity: 'NFT · Средний', value: 2250 },
  magic_potion: { name: 'Magic Potion NFT', emoji: '🧪', rarity: 'NFT · Средний', value: 2350 },
  mahjong_tile: { name: 'Mahjong Tile NFT', emoji: '🀄', rarity: 'NFT · Средний', value: 2450 },
  mini_oscar: { name: 'Mini Oscar NFT', emoji: '🏆', rarity: 'NFT · Средний', value: 2550 },
  nail_bracelet: { name: 'Nail Bracelet NFT', emoji: '📿', rarity: 'NFT · Средний', value: 2650 },
  party_sparkler: { name: 'Party Sparkler NFT', emoji: '🎇', rarity: 'NFT · Средний', value: 2750 },
  perfume_bottle: { name: 'Perfume Bottle NFT', emoji: '🧴', rarity: 'NFT · Средний', value: 2850 },
  pet_snake: { name: 'Pet Snake NFT', emoji: '🐍', rarity: 'NFT · Средний', value: 2950 },
};

function getCase(id) { return CASES.find(item => item.id === id); }
function pickDrop(drops) {
  const total = drops.reduce((sum, item) => sum + item.weight, 0);
  let roll = require('node:crypto').randomInt(1, total + 1);
  for (const item of drops) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return drops[drops.length - 1];
}

module.exports = { CASES, GIFT_DATA, getCase, pickDrop };
