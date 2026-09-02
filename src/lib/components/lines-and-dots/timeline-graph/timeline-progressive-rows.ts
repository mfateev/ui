export const INITIAL_TIMELINE_PAINT_ROWS = 128;

export const initialTimelinePaintRows = (availableRows: number): number =>
  Math.min(availableRows, INITIAL_TIMELINE_PAINT_ROWS);

export const shouldBatchTimelineRows = ({
  availableRows,
  presentedRows,
}: {
  availableRows: number;
  presentedRows: number;
}): boolean => availableRows - presentedRows > INITIAL_TIMELINE_PAINT_ROWS;

export const nextTimelinePaintRows = ({
  availableRows,
  presentedRows,
}: {
  availableRows: number;
  presentedRows: number;
}): number =>
  Math.min(
    availableRows,
    Math.max(INITIAL_TIMELINE_PAINT_ROWS, presentedRows * 2),
  );
