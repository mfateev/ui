export const getTimelineChildToggleRowTops = (
  rowStack: HTMLElement | null,
  originY: number,
  limit = 256,
): Map<string, number> => {
  const rows = Array.from(
    rowStack?.querySelectorAll<HTMLElement>('li[data-timeline-key]') ?? [],
  )
    .filter((row) => row.getClientRects().length > 0)
    .map((row) => ({
      key: row.dataset.timelineKey ?? '',
      top: row.getBoundingClientRect().top,
    }))
    .filter(({ key }) => key.length > 0)
    .sort(
      (left, right) =>
        Math.abs(left.top - originY) - Math.abs(right.top - originY),
    );

  return new Map(
    rows.slice(0, limit).map(({ key, top }) => [key, top] as const),
  );
};

export const isTimelineChildToggleOriginRow = ({
  kind,
  top,
  originY,
  rowHeight,
}: {
  kind: 'row' | 'frame';
  top: number;
  originY: number;
  rowHeight: number;
}): boolean => kind === 'row' && Math.abs(top + rowHeight / 2 - originY) <= 1;

export const getTimelineChildToggleExitOffset = ({
  direction,
  kind,
  top,
  originY,
  rowHeight,
  offsetPx,
}: {
  direction: 'expand' | 'collapse';
  kind: 'row' | 'frame';
  top: number;
  originY: number;
  rowHeight: number;
  offsetPx: number;
}): number => {
  if (direction === 'collapse') return -offsetPx;

  const isOriginRow = isTimelineChildToggleOriginRow({
    kind,
    top,
    originY,
    rowHeight,
  });
  return isOriginRow ? 0 : offsetPx;
};
