export function shouldMoveFocusToTimeline({
  focusedGroupId,
  focusedSlotIndex,
  visibleGroupIds,
  slotGroupIds,
}: {
  focusedGroupId: string | null;
  focusedSlotIndex: number | null;
  visibleGroupIds: ReadonlySet<string>;
  slotGroupIds: readonly (string | null)[];
}): boolean {
  if (focusedGroupId === null || focusedSlotIndex === null) return false;

  return (
    !visibleGroupIds.has(focusedGroupId) ||
    slotGroupIds[focusedSlotIndex] !== focusedGroupId
  );
}
