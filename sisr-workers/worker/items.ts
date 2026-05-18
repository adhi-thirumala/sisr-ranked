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

export function chooseTargetItem(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return TARGET_ITEMS[bytes[0] % TARGET_ITEMS.length];
}
