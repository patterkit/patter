// The thin runner: the flow API turned from pull to push, for straightforward games. Start a conversation,
// and the runner hands each beat to the game as an event; the game shows it however it likes and calls
// next() when it's ready. A choice waits for choose(id). Nothing else: no timing, no auto-advance, no UI,
// no audio. A line carries its beat id, so a game plays its recording with the audio resolver, or its own.
// The same runner in every Patterplay runtime: a port of the JS reference's Runner (packages/play-helpers,
// runner.ts), idiom only. UPatterRunnerComponent is the Blueprint face of the same rules.
//
//   patter::Runner runner(*engine);
//   runner.onLine([&](const StepResult& step) { show(step.speakerLabel, step.text); });
//   runner.onChoice([&](const RunnerChoice& c) { offer(c.options); });   // then runner.choose(id)
//   runner.onEnded([&] { close(); });
//   runner.begin();            // the project's start scene; next() on each click
//
// A fuller dialogue manager for more complex games, Patterstage, is coming.
#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include "Engine.h"

namespace patter
{
    /** What the choice event hands its handler: the pending choice's group and its options. */
    struct RunnerChoice
    {
        std::string groupId;
        std::vector<ChoiceOption> options;
    };

    /**
     * Plays one flow, a beat at a time, as events. Every delivered beat (a line, a text or a game event)
     * waits for next(); a choice waits for choose(). Handlers may call next() or choose() themselves: the
     * runner finishes the event it is delivering first, so a long run never deepens the stack.
     *
     * The runner keeps no state a save needs: engine.saveGame() and loadGame() stay the one way to save.
     * After a load, call next() to carry on (re-show the last line with flow.stepFor(id) if you like). After
     * engine.hotSwap(), hand the new engine to rebind(). Refusals throw, as the rest of the core does.
     */
    class Runner
    {
    public:
        using StepHandler = std::function<void(const StepResult&)>;
        using ChoiceHandler = std::function<void(const RunnerChoice&)>;
        using EndedHandler = std::function<void()>;
        /** A handler's ticket, for off(). */
        using Subscription = std::uint64_t;

        explicit Runner(Engine& engine, std::string flowId = "main") : engine_(&engine), flowId_(std::move(flowId)) {}

        const std::string& flowId() const { return flowId_; }

        /** The flow the runner plays, looked up by id each time: a load or a hot swap replaces it. Null
         *  before the first begin(). */
        Flow* flow() const { return engine_->getFlow(flowId_); }

        // Listen for an event; each returns a ticket that off() takes to stop listening.
        Subscription onLine(StepHandler handler) { return add(line_, std::move(handler)); }
        Subscription onText(StepHandler handler) { return add(text_, std::move(handler)); }
        Subscription onGameEvent(StepHandler handler) { return add(gameEvent_, std::move(handler)); }
        Subscription onChoice(ChoiceHandler handler) { return add(choice_, std::move(handler)); }
        Subscription onEnded(EndedHandler handler) { return add(ended_, std::move(handler)); }

        /** Stop a handler listening, whichever event it was for. */
        void off(Subscription ticket)
        {
            line_.erase(ticket); text_.erase(ticket); gameEvent_.erase(ticket); choice_.erase(ticket); ended_.erase(ticket);
        }

        /**
         * Start a conversation at a scene (and block), and deliver its first beat. The first begin opens the
         * flow. A later one moves the same flow there, as an authored jump does, so visit counts, variations
         * and the flow's own properties carry on through the playthrough.
         *
         * With no scene, the story starts from the beginning, at the project's start scene: the first time
         * opens the flow there, and a later time resets it (flow.reset()), forgetting the flow's own state, as
         * a new game does. Throws on an address that doesn't resolve, before anything changes.
         */
        void begin(const std::string& scene = std::string(), const std::string& block = std::string())
        {
            Flow* current = flow();
            if (!current || current->isClosed())
                engine_->openFlow(flowId_, scene, block);
            else if (scene.empty())
            {
                if (!block.empty()) throw std::runtime_error("Runner.begin: a block needs its scene");
                current->reset();
            }
            else if (!current->gotoAddress(scene, block))
                throw std::runtime_error("Runner.begin: address not found: " + scene + (block.empty() ? "" : " / " + block));
            queued_ = 0;
            next();
        }

        /** Deliver the next beat, the pending choice, or the end. */
        void next()
        {
            if (!flow()) throw std::runtime_error("Runner.next: flow '" + flowId_ + "' isn't open; call begin() first");
            ++queued_;
            if (delivering_) return;
            delivering_ = true;
            // Cleared however the loop leaves, a throw included, so the next call delivers again.
            struct Done { Runner& r; ~Done() { r.delivering_ = false; r.queued_ = 0; } } done{*this};
            while (queued_ > 0)
            {
                --queued_;
                Flow* playing = flow();
                if (!playing) throw std::runtime_error("Runner.next: flow '" + flowId_ + "' was closed while it played");
                deliver(playing->advance());
            }
        }

        /** Pick an option of the pending choice, then deliver what it leads to. Throws as flow.choose does
         *  (no choice pending, an unknown option, or one that isn't eligible). */
        void choose(const std::string& id)
        {
            Flow* current = flow();
            if (!current) throw std::runtime_error("Runner.choose: flow '" + flowId_ + "' isn't open; call begin() first");
            current->choose(id);
            next();
        }

        /**
         * Stop delivering: any next() a handler asked for is dropped, and nothing more is delivered until the
         * game asks. The flow stays where it is, open and saveable, and ended is not raised; next() carries on
         * from there and begin() begins elsewhere.
         */
        void stop() { queued_ = 0; }

        /** Play on a replacement engine (what engine.hotSwap() returns). */
        void rebind(Engine& engine) { engine_ = &engine; }

    private:
        template <typename H>
        Subscription add(std::map<Subscription, H>& into, H handler)
        {
            const Subscription ticket = ++lastTicket_;
            into.emplace(ticket, std::move(handler));
            return ticket;
        }

        // Each event's handlers are copied before they're called, so one that stops listening (or adds
        // another) mid-delivery doesn't disturb the round in progress.
        template <typename H, typename... Args>
        static void emit(const std::map<Subscription, H>& handlers, const Args&... args)
        {
            const std::map<Subscription, H> round = handlers;
            for (const auto& h : round) h.second(args...);
        }

        void deliver(const StepResult& step)
        {
            switch (step.type)
            {
                case StepType::Line: emit(line_, step); return;
                case StepType::Text: emit(text_, step); return;
                case StepType::GameEvent: emit(gameEvent_, step); return;
                case StepType::Choice: emit(choice_, RunnerChoice{step.groupId, step.options}); return;
                case StepType::End: emit(ended_); return;
            }
        }

        Engine* engine_;
        std::string flowId_;
        std::map<Subscription, StepHandler> line_, text_, gameEvent_;
        std::map<Subscription, ChoiceHandler> choice_;
        std::map<Subscription, EndedHandler> ended_;
        Subscription lastTicket_ = 0;
        /** next() calls asked for while an event was being delivered, played once it returns. */
        int queued_ = 0;
        bool delivering_ = false;
    };
}
