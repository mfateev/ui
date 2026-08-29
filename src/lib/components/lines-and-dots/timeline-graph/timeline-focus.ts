export function shouldMoveFocusToTimeline({
  focusWithinTimeline,
  focusedGroupId,
  focusedSlotIndex,
  visibleGroupIds,
  slotGroupIds,
}: {
  focusWithinTimeline: boolean;
  focusedGroupId: string | null;
  focusedSlotIndex: number | null;
  visibleGroupIds: ReadonlySet<string>;
  slotGroupIds: readonly (string | null)[];
}): boolean {
  if (!focusWithinTimeline) return false;
  if (focusedGroupId === null || focusedSlotIndex === null) return false;

  return (
    !visibleGroupIds.has(focusedGroupId) ||
    slotGroupIds[focusedSlotIndex] !== focusedGroupId
  );
}
