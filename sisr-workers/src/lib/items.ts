export const TARGET_ITEMS = [
  'minecraft:apple',
  'minecraft:bread',
  'minecraft:coal',
  'minecraft:copper_ingot',
  'minecraft:iron_ingot',
  'minecraft:gold_ingot',
  'minecraft:redstone',
  'minecraft:lapis_lazuli',
  'minecraft:diamond',
  'minecraft:emerald',
  'minecraft:shield',
  'minecraft:bow',
  'minecraft:crossbow',
  'minecraft:fishing_rod',
  'minecraft:bucket',
  'minecraft:flint',
  'minecraft:compass',
  'minecraft:clock',
  'minecraft:saddle',
  'minecraft:name_tag',
  'minecraft:ender_pearl',
  'minecraft:blaze_rod',
  'minecraft:slime_ball',
  'minecraft:book',
  'minecraft:paper',
  'minecraft:sugar',
  'minecraft:cookie',
  'minecraft:pumpkin_pie',
  'minecraft:hay_block',
  'minecraft:anvil',
];

export interface RevealConfig {
  targetItem: string;
  sequence: string[];
}

export function createRevealConfig(targetItem: string): RevealConfig {
  const fillerItems = shuffle(TARGET_ITEMS.filter((item) => item !== targetItem));
  const sequence = Array.from({ length: 27 }, (_, index) => fillerItems[index % fillerItems.length]);
  return {
    targetItem,
    sequence: [...sequence, targetItem],
  };
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}
