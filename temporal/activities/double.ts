export default async function (value: number): Promise<number> {
  return value * 2;
}

export async function delayedDouble(
  value: number,
  durationMs: number,
): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  return value * 2;
}
