type TimelineSceneDoubleBufferOptions<Scene> = {
  delayMs: number;
  keys: (scene: Scene) => readonly string[];
  onCommit: (scene: Scene) => void;
  shouldWait?: () => boolean;
};

export class TimelineSceneDoubleBuffer<Scene> {
  private committed: Scene | null = null;
  private pending: Scene | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(
    private readonly options: TimelineSceneDoubleBufferOptions<Scene>,
  ) {}

  publish(scene: Scene, deferStructuralChange: boolean): void {
    if (
      this.committed === null ||
      !deferStructuralChange ||
      this.hasSameStructure(this.committed, scene)
    ) {
      this.commit(scene);
      return;
    }

    if (this.pending && this.hasSameStructure(this.pending, scene)) {
      this.pending = scene;
      return;
    }

    this.pending = scene;
    const generation = ++this.generation;
    this.clearTimer();
    this.timer = setTimeout(
      () => this.settle(generation),
      this.options.delayMs,
    );
  }

  flush(): void {
    if (this.pending) this.commit(this.pending);
  }

  dispose(): void {
    this.generation += 1;
    this.clearTimer();
    this.pending = null;
    this.committed = null;
  }

  private hasSameStructure(left: Scene, right: Scene): boolean {
    const leftKeys = this.options.keys(left);
    const rightKeys = this.options.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index])
    );
  }

  private settle(generation: number): void {
    if (generation !== this.generation || !this.pending) return;
    if (this.options.shouldWait?.()) {
      this.timer = setTimeout(() => this.settle(generation), 50);
      return;
    }
    this.commit(this.pending);
  }

  private commit(scene: Scene): void {
    this.generation += 1;
    this.clearTimer();
    this.pending = null;
    this.committed = scene;
    this.options.onCommit(scene);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
