import type {
  TimelineGroupSummary,
  TimelineRunModel,
} from '$lib/services/timeline-run-model';

const CHUNK_SIZE = 4096;
const WORD_BITS = 32;
const PREFIX_BLOCK_WORDS = 32;

const popcount = (value: number): number => {
  let word = value >>> 0;
  word -= (word >>> 1) & 0x55555555;
  word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
  return (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export class TimelineVisibilityBitset {
  readonly words: Uint32Array;
  private prefixes: Uint32Array | null = null;

  constructor(
    readonly length: number,
    words?: Uint32Array,
  ) {
    this.words = words ?? new Uint32Array(Math.ceil(length / WORD_BITS));
  }

  static all(length: number): TimelineVisibilityBitset {
    const words = new Uint32Array(Math.ceil(length / WORD_BITS));
    words.fill(0xffffffff);
    const trailingBits = length & (WORD_BITS - 1);
    if (trailingBits && words.length > 0) {
      words[words.length - 1] = 0xffffffff >>> (WORD_BITS - trailingBits);
    }
    return new TimelineVisibilityBitset(length, words);
  }

  set(ordinal: number, visible = true): void {
    if (ordinal < 0 || ordinal >= this.length) return;
    const word = ordinal >>> 5;
    const mask = 1 << (ordinal & 31);
    if (visible) this.words[word] |= mask;
    else this.words[word] &= ~mask;
    this.prefixes = null;
  }

  has(ordinal: number): boolean {
    if (ordinal < 0 || ordinal >= this.length) return false;
    return Boolean(this.words[ordinal >>> 5] & (1 << (ordinal & 31)));
  }

  and(other: TimelineVisibilityBitset): TimelineVisibilityBitset {
    const length = Math.min(this.length, other.length);
    const result = new TimelineVisibilityBitset(length);
    for (let index = 0; index < result.words.length; index += 1) {
      result.words[index] = this.words[index] & other.words[index];
    }
    return result;
  }

  rank(ordinal: number): number {
    const end = Math.min(this.length, Math.max(0, ordinal));
    const endWord = end >>> 5;
    const prefixes = this.getPrefixes();
    const block = Math.floor(endWord / PREFIX_BLOCK_WORDS);
    let count = prefixes[block];
    const blockStart = block * PREFIX_BLOCK_WORDS;
    for (let word = blockStart; word < endWord; word += 1) {
      count += popcount(this.words[word]);
    }
    const bits = end & 31;
    if (bits && endWord < this.words.length) {
      count += popcount(this.words[endWord] & (0xffffffff >>> (32 - bits)));
    }
    return count;
  }

  select(rank: number): number | undefined {
    if (rank < 0 || rank >= this.count) return undefined;
    const prefixes = this.getPrefixes();
    let low = 0;
    let high = prefixes.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (prefixes[middle] <= rank) low = middle;
      else high = middle;
    }
    let remaining = rank - prefixes[low];
    const startWord = low * PREFIX_BLOCK_WORDS;
    const endWord = Math.min(this.words.length, startWord + PREFIX_BLOCK_WORDS);
    for (let wordIndex = startWord; wordIndex < endWord; wordIndex += 1) {
      let word = this.words[wordIndex];
      const count = popcount(word);
      if (remaining >= count) {
        remaining -= count;
        continue;
      }
      while (word) {
        const lowest = word & -word;
        if (remaining === 0) {
          const bit = 31 - Math.clz32(lowest);
          const ordinal = wordIndex * WORD_BITS + bit;
          return ordinal < this.length ? ordinal : undefined;
        }
        word ^= lowest;
        remaining -= 1;
      }
    }
    return undefined;
  }

  get count(): number {
    return this.rank(this.length);
  }

  private getPrefixes(): Uint32Array {
    if (this.prefixes) return this.prefixes;
    const blockCount = Math.ceil(this.words.length / PREFIX_BLOCK_WORDS);
    const prefixes = new Uint32Array(blockCount + 1);
    let count = 0;
    for (let block = 0; block < blockCount; block += 1) {
      prefixes[block] = count;
      const start = block * PREFIX_BLOCK_WORDS;
      const end = Math.min(this.words.length, start + PREFIX_BLOCK_WORDS);
      for (let word = start; word < end; word += 1) {
        count += popcount(this.words[word]);
      }
    }
    prefixes[blockCount] = count;
    this.prefixes = prefixes;
    return prefixes;
  }
}

type IndexChunk = {
  left: Int32Array;
  right: Int32Array;
  priority: Uint32Array;
  subtreeMaxEndTimeMs: Float64Array;
};

export type TimelineIntervalQuery = {
  ordinals: number[];
  mask: TimelineVisibilityBitset;
  visitedNodes: number;
  pendingVisited: number;
  truncatedPending: boolean;
};

const priorityFor = (ordinal: number): number => {
  let value = (ordinal + 1) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
};

export class TimelineIntervalIndex {
  private root = -1;
  private readonly chunks: IndexChunk[] = [];
  private readonly indexedVersion = new Map<string, number>();
  private readonly ordinalByKey = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  private readonly pendingKeyByOrdinal = new Map<number, string>();

  constructor(
    private readonly model: TimelineRunModel,
    private readonly maximumPendingScan = 100_000,
  ) {}

  ingest(startOrdinal = 0, endOrdinal = this.model.groupCount): void {
    for (
      let ordinal = Math.max(0, startOrdinal);
      ordinal < Math.min(endOrdinal, this.model.groupCount);
      ordinal += 1
    ) {
      this.upsert(ordinal);
    }
  }

  upsert(ordinal: number): void {
    const summary = this.model.groupAt(ordinal);
    if (!summary) return;
    const previousOrdinal = this.ordinalByKey.get(summary.key);
    if (previousOrdinal !== undefined) this.removeOrdinal(previousOrdinal);
    this.ordinalByKey.set(summary.key, ordinal);
    this.indexedVersion.set(summary.key, summary.version);
    if (summary.pending) {
      this.pending.set(summary.key, ordinal);
      this.pendingKeyByOrdinal.set(ordinal, summary.key);
      return;
    }
    this.pending.delete(summary.key);
    this.pendingKeyByOrdinal.delete(ordinal);
    this.initializeNode(ordinal, summary);
    this.root = this.insert(this.root, ordinal);
  }

  remove(key: string): void {
    const ordinal = this.ordinalByKey.get(key);
    if (ordinal === undefined) return;
    this.removeOrdinal(ordinal);
    this.ordinalByKey.delete(key);
    this.indexedVersion.delete(key);
    this.pending.delete(key);
    this.pendingKeyByOrdinal.delete(ordinal);
  }

  query(
    startTimeMs: number,
    endTimeMs: number,
    pendingEndTimeMs: number,
  ): TimelineIntervalQuery {
    const mask = new TimelineVisibilityBitset(this.model.groupCount);
    const ordinals: number[] = [];
    let visitedNodes = 0;
    const visit = (node: number): void => {
      if (node < 0 || this.maxEnd(node) < startTimeMs) return;
      visitedNodes += 1;
      const summary = this.summary(node);
      if (!summary) return;
      const left = this.left(node);
      if (left >= 0) visit(left);
      if (
        summary.startTimeMs <= endTimeMs &&
        summary.endTimeMs >= startTimeMs
      ) {
        mask.set(node);
        ordinals.push(node);
      }
      if (summary.startTimeMs <= endTimeMs) {
        const right = this.right(node);
        if (right >= 0) visit(right);
      }
    };
    visit(this.root);

    let pendingVisited = 0;
    let truncatedPending = false;
    for (const ordinal of this.pending.values()) {
      if (pendingVisited >= this.maximumPendingScan) {
        truncatedPending = true;
        break;
      }
      pendingVisited += 1;
      const summary = this.model.groupAt(ordinal);
      if (
        summary &&
        summary.startTimeMs <= endTimeMs &&
        Math.max(summary.endTimeMs, pendingEndTimeMs) >= startTimeMs
      ) {
        mask.set(ordinal);
        ordinals.push(ordinal);
      }
    }
    ordinals.sort((left, right) => left - right);
    return {
      ordinals,
      mask,
      visitedNodes,
      pendingVisited,
      truncatedPending,
    };
  }

  all(): TimelineVisibilityBitset {
    const mask = new TimelineVisibilityBitset(this.model.groupCount);
    for (let ordinal = 0; ordinal < this.model.groupCount; ordinal += 1) {
      mask.set(ordinal);
    }
    return mask;
  }

  private removeOrdinal(ordinal: number): void {
    const pendingKey = this.pendingKeyByOrdinal.get(ordinal);
    if (pendingKey) {
      this.pending.delete(pendingKey);
      this.pendingKeyByOrdinal.delete(ordinal);
      return;
    }
    this.root = this.erase(this.root, ordinal);
  }

  private insert(root: number, node: number): number {
    if (root < 0) return node;
    if (this.compare(node, root) < 0) {
      this.setLeft(root, this.insert(this.left(root), node));
      if (this.priority(node) < this.priority(root))
        root = this.rotateRight(root);
    } else {
      this.setRight(root, this.insert(this.right(root), node));
      if (this.priority(node) < this.priority(root))
        root = this.rotateLeft(root);
    }
    this.update(root);
    return root;
  }

  private erase(root: number, node: number): number {
    if (root < 0) return root;
    const comparison = this.compare(node, root);
    if (comparison < 0) this.setLeft(root, this.erase(this.left(root), node));
    else if (comparison > 0)
      this.setRight(root, this.erase(this.right(root), node));
    else if (this.left(root) < 0) return this.right(root);
    else if (this.right(root) < 0) return this.left(root);
    else if (this.priority(this.left(root)) < this.priority(this.right(root))) {
      root = this.rotateRight(root);
      this.setRight(root, this.erase(this.right(root), node));
    } else {
      root = this.rotateLeft(root);
      this.setLeft(root, this.erase(this.left(root), node));
    }
    this.update(root);
    return root;
  }

  private rotateLeft(root: number): number {
    const next = this.right(root);
    this.setRight(root, this.left(next));
    this.setLeft(next, root);
    this.update(root);
    this.update(next);
    return next;
  }

  private rotateRight(root: number): number {
    const next = this.left(root);
    this.setLeft(root, this.right(next));
    this.setRight(next, root);
    this.update(root);
    this.update(next);
    return next;
  }

  private compare(leftOrdinal: number, rightOrdinal: number): number {
    const left = this.summary(leftOrdinal);
    const right = this.summary(rightOrdinal);
    if (!left || !right) return leftOrdinal - rightOrdinal;
    return (
      left.startTimeMs - right.startTimeMs ||
      left.initialEventId - right.initialEventId ||
      leftOrdinal - rightOrdinal
    );
  }

  private initializeNode(ordinal: number, summary: TimelineGroupSummary): void {
    const { chunk, offset } = this.slot(ordinal);
    chunk.left[offset] = -1;
    chunk.right[offset] = -1;
    chunk.priority[offset] = priorityFor(ordinal);
    chunk.subtreeMaxEndTimeMs[offset] = summary.endTimeMs;
  }

  private update(ordinal: number): void {
    if (ordinal < 0) return;
    const summary = this.summary(ordinal);
    if (!summary) return;
    let maximum = summary.endTimeMs;
    const left = this.left(ordinal);
    const right = this.right(ordinal);
    if (left >= 0) maximum = Math.max(maximum, this.maxEnd(left));
    if (right >= 0) maximum = Math.max(maximum, this.maxEnd(right));
    const { chunk, offset } = this.slot(ordinal);
    chunk.subtreeMaxEndTimeMs[offset] = maximum;
  }

  private summary(ordinal: number): TimelineGroupSummary | undefined {
    return this.model.groupAt(ordinal);
  }

  private left(ordinal: number): number {
    const { chunk, offset } = this.slot(ordinal);
    return chunk.left[offset];
  }

  private right(ordinal: number): number {
    const { chunk, offset } = this.slot(ordinal);
    return chunk.right[offset];
  }

  private priority(ordinal: number): number {
    const { chunk, offset } = this.slot(ordinal);
    return chunk.priority[offset];
  }

  private maxEnd(ordinal: number): number {
    const { chunk, offset } = this.slot(ordinal);
    return chunk.subtreeMaxEndTimeMs[offset];
  }

  private setLeft(ordinal: number, left: number): void {
    const { chunk, offset } = this.slot(ordinal);
    chunk.left[offset] = left;
  }

  private setRight(ordinal: number, right: number): void {
    const { chunk, offset } = this.slot(ordinal);
    chunk.right[offset] = right;
  }

  private slot(ordinal: number): { chunk: IndexChunk; offset: number } {
    const chunkIndex = Math.floor(ordinal / CHUNK_SIZE);
    while (this.chunks.length <= chunkIndex) {
      const left = new Int32Array(CHUNK_SIZE);
      const right = new Int32Array(CHUNK_SIZE);
      left.fill(-1);
      right.fill(-1);
      this.chunks.push({
        left,
        right,
        priority: new Uint32Array(CHUNK_SIZE),
        subtreeMaxEndTimeMs: new Float64Array(CHUNK_SIZE),
      });
    }
    return {
      chunk: this.chunks[chunkIndex],
      offset: ordinal % CHUNK_SIZE,
    };
  }
}
