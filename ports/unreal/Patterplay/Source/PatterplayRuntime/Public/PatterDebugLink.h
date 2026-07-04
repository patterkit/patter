// FPatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
// story position to the editor over a loopback WebSocket, so Patterpad follows the live cursor like a
// debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The Unreal
// parity of the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire protocol.
//
// It is a debug tool: in a Shipping build every method is a no-op and the WebSockets dependency is
// compiled out entirely (see PatterplayRuntime.Build.cs), so it is safe to leave wired in. Hold the
// returned shared pointer for as long as you want the link open:
//
//   Link = FPatterDebugLink::Create(Engine->GetBuildId(), TEXT("My Game"));
//   Link->FlowOpened(TEXT("main"));
//   // ...after each Advance()/Choose():
//   Link->Observe(TEXT("main"), Flow->CurrentScene(), Step.Id, StepTypeName(Step.Type));
//   // ...and when the flow ends:
//   Link->FlowClosed(TEXT("main"));
#pragma once

#include "CoreMinimal.h"
#include "Templates/SharedPointer.h"

class IWebSocket;

class PATTERPLAYRUNTIME_API FPatterDebugLink : public TSharedFromThis<FPatterDebugLink>
{
public:
	// Open a link to the editor. `Build` is the bundle's content hash (UPatterEngine::GetBuildId()).
	static TSharedRef<FPatterDebugLink> Create(const FString& Build, const FString& Project = FString(), const FString& Url = TEXT("ws://127.0.0.1:4471"));
	~FPatterDebugLink();

	/** Tell the editor a flow opened (so it can list it in the follow selector). */
	void FlowOpened(const FString& FlowId);
	/** Tell the editor a flow closed. */
	void FlowClosed(const FString& FlowId);
	/** Report a flow's current position - call after each Advance()/Choose(). Empty BeatId -> null on the wire. */
	void Observe(const FString& FlowId, const FString& SceneId, const FString& BeatId, const FString& Type, const FString& ChoiceId = FString());
	/** Close the link. */
	void Close();

	/** Live bundle refresh: the editor pushed a freshly compiled bundle. `Data` is the full .patterc
	 *  JSON - load it (UPatterBundle::LoadFromString) and hand it to UPatterEngine::ApplyLiveBundle,
	 *  then call SetBuild(Build) so the editor's pill flips back to in-sync. Fires on the game thread.
	 *  Never fires with malformed payloads. No-op in Shipping (the whole link compiles out). */
	TFunction<void(const FString& Build, const FString& Data)> OnBundle;

	/** After applying a pushed bundle: report the build now running (re-hellos, so the editor's
	 *  match/stale pill updates and it stops re-pushing the same bundle). */
	void SetBuild(const FString& Build);

private:
	FPatterDebugLink(const FString& InBuild, const FString& InProject, const FString& InUrl);
	void Connect();
	void Post(const FString& Message);
	void Flush();
	FString HelloMessage() const;

	FString BuildId;
	FString Project;
	FString Url;
	TSet<FString> Flows;
	TArray<FString> Queue;   // messages awaiting an open socket
	bool bOpen = false;
	TSharedPtr<IWebSocket> Socket;
};
