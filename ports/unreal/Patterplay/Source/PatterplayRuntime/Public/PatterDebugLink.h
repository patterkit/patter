// FPatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
// story position to the editor over a loopback WebSocket, so Patterpad follows the live cursor like a
// debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The Unreal
// parity of the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire protocol.
//
// It is a debug tool: in a Shipping build every method is a no-op and the WebSockets dependency is
// compiled out entirely (see PatterplayRuntime.Build.cs), so it is safe to leave wired in. Hold the
// returned shared pointer for as long as you want the link open.
//
// It reconnects: while the link is open, a socket that closes (or never opens) is tried again after 1 s,
// doubling to at most 10 s, and sends its hello again when the editor is back. It logs one line when an
// established link is lost and one when it's back, nothing per attempt. A link the editor replaced with
// another game (close code 4000) closes for good.
//
//
//   Link = FPatterDebugLink::Create(Engine->BuildId(), TEXT("My Game"));
//   Link->FlowOpened(TEXT("main"));
//   // ...after each Advance()/Choose():
//   Link->Observe(TEXT("main"), Flow->CurrentScene(), Step.Id, FPatterDebugLink::TypeName(Step.Type));
//   // ...and when the flow ends:
//   Link->FlowClosed(TEXT("main"));
#pragma once

#include "CoreMinimal.h"
#include "Templates/SharedPointer.h"
#include "Containers/Ticker.h"
#include "PatterTypes.h"

class IWebSocket;

/** Play in game: the editor asked the running game to start a block now. Ids are the bundle's. */
struct FPatterPlayRequest
{
	/** Echo it in ReplyPlay so the editor can match the answer to its request. */
	FString Id;
	FString SceneId;
	FString BlockId;
	/** Stop what the speakers are doing first, rather than turn the request down as busy. */
	bool bTakeOver = false;
	/** The editor's bundle hash, or empty: a game on another build can answer "staleBuild". */
	FString Build;
};

/** The game's answer to an FPatterPlayRequest. */
struct FPatterPlayResult
{
	bool bStarted = false;
	/** Why it didn't start, as a short code: "busy", "unknownBlock", "staleBuild", or the game's own. Empty: none. */
	FString Reason;
	/** More, in plain words (which speaker is busy, which block was missing). Empty: none. */
	FString Detail;
};

class PATTERPLAYRUNTIME_API FPatterDebugLink : public TSharedFromThis<FPatterDebugLink>
{
public:
	// Open a link to the editor. `Build` is the bundle's content hash (UPatterEngine::BuildId()).
	static TSharedRef<FPatterDebugLink> Create(const FString& Build, const FString& Project = FString(), const FString& Url = TEXT("ws://127.0.0.1:4471"));
	~FPatterDebugLink();

	/** Tell the editor a flow opened (so it can list it in the follow selector). */
	void FlowOpened(const FString& FlowId);
	/** Tell the editor a flow closed. */
	void FlowClosed(const FString& FlowId);
	/** Report a flow's current position - call after each Advance()/Choose(). An empty SceneId or BeatId goes as null on the wire. */
	void Observe(const FString& FlowId, const FString& SceneId, const FString& BeatId, const FString& Type, const FString& ChoiceId = FString());
	/** A step type as the wire spells it, for Observe's Type: "line", "text", "gameEvent", "choice", or "end".
	 *  Unity's PatterDebugLink.TypeName. */
	static FString TypeName(EPatterStepType Type);
	/** Close the link. */
	void Close();

	/** Live bundle refresh: the editor pushed a freshly compiled bundle. `Data` is the full .patterc
	 *  JSON - load it (UPatterBundle::LoadFromString) and hand it to UPatterEngine::ApplyLiveBundle,
	 *  then call SetBuild(Build) so the editor's pill flips back to in-sync. Fires on the game thread.
	 *  Never fires with malformed payloads. No-op in Shipping (the whole link compiles out). */
	TFunction<void(const FString& Build, const FString& Data)> OnBundle;

	/** Play in game: the writer asked the game to start a block now. Answer with ReplyPlay(Request.Id, Result),
	 *  at once or a frame or more later; an answer after the editor stopped waiting is ignored. Fires on the game
	 *  thread. Unbound, the link answers { started: false, reason: "unhandled" } itself. Never fires with
	 *  malformed payloads. No-op in Shipping. */
	TFunction<void(const FPatterPlayRequest& Request)> OnPlay;

	/** Answer a play request (see OnPlay). Call it from the game thread. A no-op once the link is closed. */
	void ReplyPlay(const FString& Id, const FPatterPlayResult& Result);

	/** After applying a pushed bundle: report the build now running (re-hellos, so the editor's
	 *  match/stale pill updates and it stops re-pushing the same bundle). */
	void SetBuild(const FString& Build);

	/** What the link is doing, for the editor's Runtime State panel: "connecting", "connected" or
	 *  "closed". From inside a running game "the editor is not listening" and "I never attached" look
	 *  identical, and that is the first question a link's user asks
	 *  (from-storylets/weak-debug-registries). Always "closed" in Shipping, where the link is a no-op. */
	FString State() const;
	/** The build identity this link handshook with (moves on SetBuild after a live refresh). */
	const FString& Build() const { return BuildId; }
	/** The editor address this link dials. */
	const FString& Url() const { return DialUrl; }

private:
	friend struct FPatterDebugLinkTestAccess;   // the automation test drives the socket's events itself

	FPatterDebugLink(const FString& InBuild, const FString& InProject, const FString& InUrl);
	void Connect();
	void HandleConnected();
	void HandleGone(int32 StatusCode);   // the socket closed (StatusCode from OnClosed) or never opened (-1)
	void RetryTick();
	void Post(const FString& Message);
	void Send(const FString& Message);
	void Flush();
	void DropSocket();
	FString HelloMessage() const;

	FString BuildId;
	FString Project;
	FString DialUrl;
	TSet<FString> Flows;
	TArray<FString> Queue;   // messages awaiting the first socket's open
	bool bOpen = false;
	bool bClosed = false;    // Close() was called, or the editor replaced this link
	bool bStartup = true;    // queue only until the first attempt fails or closes, never again after that
	bool bLost = false;      // an established link went away and we said so; say so when it's back
	double RetryAt = 0.0;    // FPlatformTime::Seconds() of the next attempt; 0 while one is under way
	double RetryWait = 1.0;  // seconds: 1, doubling to 10, back to 1 once a hello goes out
	FTSTicker::FDelegateHandle RetryTicker;
	TArray<FString>* SentForTest = nullptr;   // the automation test's: what Send would have sent
	TSharedPtr<IWebSocket> Socket;
};
