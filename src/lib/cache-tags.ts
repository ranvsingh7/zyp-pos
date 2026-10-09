export function menuDataTag(restaurantId: string): string {
  return `restaurant:${restaurantId}:menu`;
}

export function tableDataTag(restaurantId: string): string {
  return `restaurant:${restaurantId}:tables`;
}

export function staffDataTag(restaurantId: string): string {
  return `restaurant:${restaurantId}:staff`;
}
