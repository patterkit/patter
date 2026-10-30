// ---------------------------------------------------------------------------
// The thin runner: the flow API turned from pull to push, for straightforward
// games. Start a conversation, and the runner hands each beat to the game as an
// event; the game shows it however it likes and calls next() when it's ready.
// A choice waits for choose(id). Nothing else: no timing, no auto-advance, no
// UI, no audio. A line carries its beat id, so a game plays its recording with
// the audio resolver, or its own. The same runner in every Patterplay runtime.
//
//   const runner = new Runner(engine);
//   runner.on("line", (step) => { show(step.speakerLabel, step.text); });
//   runner.on("choice", (step) => offer(step.options));   // then runner.choose(id)
//   runner.on("ended", (reason) => close());   // "ended", or "ran-dry": a choice had nothing left
//   runner.begin();            // the project's start scene; next() on each click
//
// A fuller dialogue manager for more complex games, Patterstage, is coming.
// ---------------------------------------------------------------------------

import type { ChoiceOption, FlowEndReason, Engine, Flow, StepResult } from "@patterkit/runtime";

type Step<T extends StepResult["type"]> = Extract<StepResult, { type: T }>;

/** What each runner event hands its handler. */
export interface RunnerEvents {
  line: Step<"line">;
  text: Step<"text">;
  gameEvent: Step<"gameEvent">;
  choice: { groupId: string; options: ChoiceOption[] };
  /** Why the flow ended, as its `end` step says: `"ran-dry"` when a choice had nothing left to offer and
   *  nothing came after it, otherwise `"ended"`. */
  ended: FlowEndReason;
}

export type RunnerEvent = keyof RunnerEvents;

/**
 * Plays one flow, a beat at a time, as events. Every delivered beat (a line, a text or a game event)
 * waits for {@link next}; a choice waits for {@link choose}. Handlers may call `next()` or `choose()`
 * themselves: the runner finishes the event it is delivering first, so a long run never deepens the
 * stack.
 *
 * The runner keeps no state a save needs: `engine.saveGame()` and `loadGame()` stay the one way to
 * save. After a load, call `next()` to carry on (re-show the last line with `flow.stepFor(id)` if you
 * like). After `engine.hotSwap()`, hand the new engine to {@link rebind}.
 */
export class Runner {
  private readonly handlers: { [E in RunnerEvent]: Set<(payload: RunnerEvents[E]) => void> } = {
    line: new Set(), text: new Set(), gameEvent: new Set(), choice: new Set(), ended: new Set(),
  };
  /** next() calls asked for while an event was being delivered, played once it returns. */
  private queued = 0;
  private delivering = false;

  constructor(private engine: Engine, readonly flowId: string = "main") {}

  /** The flow the runner plays, looked up by id each time: a load or a hot swap replaces it. */
  get flow(): Flow | undefined {
    return this.engine.getFlow(this.flowId);
  }

  /** Listen for an event; returns a function that stops listening. */
  on<E extends RunnerEvent>(event: E, handler: (payload: RunnerEvents[E]) => void): () => void {
    const set = this.handlers[event] as Set<(payload: RunnerEvents[E]) => void>;
    set.add(handler);
    return () => { set.delete(handler); };
  }

  /**
   * Start a conversation at a scene (and block), and deliver its first beat. The first begin opens the
   * flow. A later one moves the same flow there, as an authored jump does, so visit counts, variations
   * and the flow's own properties carry on through the playthrough.
   *
   * With no scene, the story starts from the beginning, at the project's start scene: the first time
   * opens the flow there, and a later time resets it (`flow.reset()`), forgetting the flow's own state,
   * as a new game does. Throws on an address that doesn't resolve, before anything changes.
   */
  begin(scene?: string, block?: string): void {
    const flow = this.flow;
    if (!flow || flow.isClosed) {
      this.engine.openFlow(this.flowId, { scene, block });
    } else if (scene === undefined) {
      if (block !== undefined) throw new Error("Runner.begin: a block needs its scene");
      flow.reset();
    } else if (!flow.goto(scene, block)) {
      throw new Error(`Runner.begin: address not found: ${scene}${block === undefined ? "" : ` / ${block}`}`);
    }
    this.queued = 0;
    this.next();
  }

  /** Deliver the next beat, the pending choice, or the end. */
  next(): void {
    if (!this.flow) throw new Error(`Runner.next: flow '${this.flowId}' isn't open; call begin() first`);
    this.queued++;
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.queued > 0) {
        this.queued--;
        this.deliver(this.flow.advance());
      }
    } finally {
      this.delivering = false;
      this.queued = 0;
    }
  }

  /** Pick an option of the pending choice, then deliver what it leads to. Throws as `flow.choose` does
   *  (no choice pending, an unknown option, or one that isn't eligible). */
  choose(id: string): void {
    const flow = this.flow;
    if (!flow) throw new Error(`Runner.choose: flow '${this.flowId}' isn't open; call begin() first`);
    flow.choose(id);
    this.next();
  }

  /**
   * Stop delivering: any next() a handler asked for is dropped, and nothing more is delivered until the
   * game asks. The flow stays where it is, open and saveable, and `ended` is not raised; `next()` carries
   * on from there and `begin()` begins elsewhere.
   */
  stop(): void {
    this.queued = 0;
  }

  /** Play on a replacement engine (what `engine.hotSwap()` or `applyLiveBundle` returns). */
  rebind(engine: Engine): void {
    this.engine = engine;
  }

  private deliver(step: StepResult): void {
    switch (step.type) {
      case "line": return this.emit("line", step);
      case "text": return this.emit("text", step);
      case "gameEvent": return this.emit("gameEvent", step);
      case "choice": return this.emit("choice", { groupId: step.groupId, options: step.options });
      case "end": return this.emit("ended", step.reason);
    }
  }

  private emit<E extends RunnerEvent>(event: E, payload: RunnerEvents[E]): void {
    for (const handler of [...this.handlers[event]]) (handler as (p: RunnerEvents[E]) => void)(payload);
  }
}
