export type TimelinePresentationChunk = Readonly<{
  key: string;
  index: number;
  rowStart: number;
  rowEnd: number;
  active: boolean;
  lastUsed: number;
}>;

export type TimelinePresentationCounters = {
  mounts: number;
  parks: number;
  lruHits: number;
  unmounts: number;
  evictions: number;
  updates: number;
};

export type TimelineSceneBlock<Row> = Readonly<{
  key: string;
  revisionKey: string;
  rows: readonly Row[];
}>;

export class TimelineSceneBlockCache<Row> {
  readonly counters = { compilations: 0, reuses: 0 };
  private readonly scenes = new WeakMap<
    object,
    Map<string, TimelineSceneBlock<Row>>
  >();

  get(
    sceneIdentity: object,
    chunk: TimelinePresentationChunk,
    compile: (start: number, end: number) => readonly Row[],
    revisionKey = '',
  ): TimelineSceneBlock<Row> {
    let blocks = this.scenes.get(sceneIdentity);
    if (!blocks) {
      blocks = new Map();
      this.scenes.set(sceneIdentity, blocks);
    }
    const existing = blocks.get(chunk.key);
    if (existing?.revisionKey === revisionKey) {
      this.counters.reuses += 1;
      return existing;
    }
    const block = Object.freeze({
      key: chunk.key,
      revisionKey,
      rows: Object.freeze([...compile(chunk.rowStart, chunk.rowEnd)]),
    });
    blocks.set(chunk.key, block);
    this.counters.compilations += 1;
    return block;
  }
}

type MutableChunk = {
  key: string;
  index: number;
  rowStart: number;
  rowEnd: number;
  active: boolean;
  lastUsed: number;
};

export class TimelinePresentationController {
  readonly counters: TimelinePresentationCounters = {
    mounts: 0,
    parks: 0,
    lruHits: 0,
    unmounts: 0,
    evictions: 0,
    updates: 0,
  };
  private sceneIdentity: object | null = null;
  private sceneGeneration = 0;
  private clock = 0;
  private chunks = new Map<number, MutableChunk>();
  private published: readonly TimelinePresentationChunk[] = [];
  private activeKey = '';

  constructor(
    readonly chunkSize = 96,
    readonly maximumParkedChunks = 8,
  ) {}

  update({
    sceneIdentity,
    totalRows,
    windowStart,
    windowEnd,
    pinnedRows = [],
    retainAll = false,
  }: {
    sceneIdentity: object;
    totalRows: number;
    windowStart: number;
    windowEnd: number;
    pinnedRows?: readonly number[];
    retainAll?: boolean;
  }): readonly TimelinePresentationChunk[] {
    if (sceneIdentity !== this.sceneIdentity) {
      this.counters.unmounts += this.chunks.size;
      this.chunks.clear();
      this.sceneIdentity = sceneIdentity;
      this.sceneGeneration += 1;
      this.activeKey = '';
    }

    const activeIndexes = new Set<number>();
    const start = retainAll ? 0 : Math.max(0, windowStart);
    const end = retainAll ? totalRows : Math.min(totalRows, windowEnd);
    if (end > start) {
      const first = Math.floor(start / this.chunkSize);
      const last = Math.floor((end - 1) / this.chunkSize);
      for (let index = first; index <= last; index += 1) {
        activeIndexes.add(index);
      }
    }
    for (const row of pinnedRows) {
      if (row >= 0 && row < totalRows) {
        activeIndexes.add(Math.floor(row / this.chunkSize));
      }
    }
    const activeKey = [...activeIndexes]
      .sort((a, b) => a - b)
      .map(
        (index) =>
          `${index}:${Math.min(totalRows, (index + 1) * this.chunkSize)}`,
      )
      .join(',');
    if (activeKey === this.activeKey && this.chunks.size > 0) {
      return this.published;
    }

    this.activeKey = activeKey;
    this.clock += 1;
    for (const chunk of this.chunks.values()) {
      if (activeIndexes.has(chunk.index)) continue;
      if (chunk.active) this.counters.parks += 1;
      chunk.active = false;
    }
    for (const index of activeIndexes) {
      let chunk = this.chunks.get(index);
      if (chunk) {
        if (!chunk.active) this.counters.lruHits += 1;
        chunk.active = true;
        chunk.lastUsed = this.clock;
        chunk.rowEnd = Math.min(totalRows, (index + 1) * this.chunkSize);
        continue;
      }
      chunk = {
        key: `${this.sceneGeneration}:${index}`,
        index,
        rowStart: index * this.chunkSize,
        rowEnd: Math.min(totalRows, (index + 1) * this.chunkSize),
        active: true,
        lastUsed: this.clock,
      };
      this.chunks.set(index, chunk);
      this.counters.mounts += 1;
    }

    const parked = [...this.chunks.values()]
      .filter((chunk) => !chunk.active)
      .sort(
        (left, right) =>
          left.lastUsed - right.lastUsed || left.index - right.index,
      );
    while (parked.length > this.maximumParkedChunks) {
      const evicted = parked.shift();
      if (!evicted) break;
      this.chunks.delete(evicted.index);
      this.counters.evictions += 1;
      this.counters.unmounts += 1;
    }

    this.published = [...this.chunks.values()]
      .sort((left, right) => left.index - right.index)
      .map((chunk) => Object.freeze({ ...chunk }));
    this.counters.updates += 1;
    return this.published;
  }

  clear(): void {
    this.counters.unmounts += this.chunks.size;
    this.chunks.clear();
    this.published = [];
    this.activeKey = '';
    this.sceneIdentity = null;
  }
}
