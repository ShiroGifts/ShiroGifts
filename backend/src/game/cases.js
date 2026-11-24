const CASES = [
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
    { type: 'gift', key: 'ring', weight: 8 }, { type: 'gift', key: 'diamond', weight: 15 },
    { type: 'gift', key: 'random_nft', weight: 12 }, { type: 'stars', amount: 200, weight: 12 },
    { type: 'stars', amount: 500, weight: 15 }, { type: 'stars', amount: 1000, weight: 15 },
    { type: 'stars', amount: 2000, weight: 13 }, { type: 'stars', amount: 5000, weight: 10 }
  ]}
];

const GIFT_DATA = {
  bear: { name: 'Медведь', emoji: '🧸', rarity: 'Обычный', value: 15 },
  heart: { name: 'Сердце', emoji: '❤️', rarity: 'Обычный', value: 15 },
  rose: { name: 'Роза', emoji: '🌹', rarity: 'Обычный', value: 25 },
  cake: { name: 'Торт', emoji: '🎂', rarity: 'Редкий', value: 50 },
  bouquet: { name: 'Букет', emoji: '💐', rarity: 'Редкий', value: 50 },
  rocket: { name: 'Ракета', emoji: '🚀', rarity: 'Редкий', value: 50 },
  champ: { name: 'Шампанское', emoji: '🍾', rarity: 'Редкий', value: 50 },
  cup: { name: 'Кубок', emoji: '🏆', rarity: 'Эпический', value: 100 },
  ring: { name: 'Кольцо', emoji: '💍', rarity: 'Эпический', value: 100 },
  diamond: { name: 'Бриллиант', emoji: '💎', rarity: 'Легендарный', value: 100 },
  random_nft: { name: 'Рандомный NFT', emoji: '🎁', rarity: 'Мифический', value: 350 }
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
