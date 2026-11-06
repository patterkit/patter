#include "PatterDebugLink.h"

#if !UE_BUILD_SHIPPING

#include "PatterLog.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"

namespace
{
	FString SerializeJson(const TSharedRef<FJsonObject>& Obj)
	{
		FString Out;
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Obj, Writer);
		return Out;
	}

	// The editor's server closes a client it replaced (another game connected) with this code. A replaced
	// link stays closed: retrying would only take the editor back from the game that took it over.
	constexpr int32 CloseReplaced = 4000;
	// The wait before trying again after a close or a failed attempt, in seconds.
	constexpr double RetryFirst = 1.0;
	constexpr double RetryMax = 10.0;
	// How often the retry ticker looks at the clock. Coarse is fine: the waits are whole seconds.
	constexpr float RetryTickInterval = 0.1f;
}

TSharedRef<FPatterDebugLink> FPatterDebugLink::Create(const FString& Build, const FString& Project, const FString& Url)
{
	TSharedRef<FPatterDebugLink> Link = MakeShareable(new FPatterDebugLink(Build, Project, Url));
	Link->Connect();
	return Link;
}

FPatterDebugLink::FPatterDebugLink(const FString& InBuild, const FString& InProject, const FString& InUrl)
	: BuildId(InBuild), Project(InProject), DialUrl(InUrl)
{
}

FPatterDebugLink::~FPatterDebugLink()
{
	Close();
}

// Dial the editor, on a fresh socket each attempt (the last one is dropped first, outside its own
// callbacks). Each callback checks it is still this link's socket, so a late event from one already
// dropped changes nothing.
void FPatterDebugLink::Connect()
{
	if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
	{
		FModuleManager::Get().LoadModule("WebSockets");
	}
	DropSocket();
	Socket = FWebSocketsModule::Get().CreateWebSocket(DialUrl, TEXT(""));
	if (!Socket.IsValid())
	{
		bClosed = true;   // no WebSockets here at all: nothing to retry
		Queue.Reset();
		return;
	}

	TWeakPtr<FPatterDebugLink> Weak = AsShared();
	const IWebSocket* Mine = Socket.Get();
	Socket->OnConnected().AddLambda([Weak, Mine]()
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleConnected();
	});
	// Editor -> game: a live bundle refresh {t:"bundle", build, data}, or Play in game {t:"play", id,
	// sceneId, blockId, takeOver, build?}. Validate the shape here so the host's handlers never see a
	// malformed payload; anything else the editor sends is ignored.
	Socket->OnMessage().AddLambda([Weak, Mine](const FString& Message)
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Socket.Get() != Mine) return;
		TSharedPtr<FJsonObject> Msg;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Message);
		if (!FJsonSerializer::Deserialize(Reader, Msg) || !Msg.IsValid()) return;
		FString Type;
		if (!Msg->TryGetStringField(TEXT("t"), Type)) return;
		if (Type == TEXT("bundle"))
		{
			FString Build, Data;
			if (Self->OnBundle && Msg->TryGetStringField(TEXT("build"), Build) && Msg->TryGetStringField(TEXT("data"), Data))
			{
				Self->OnBundle(Build, Data);
			}
		}
		else if (Type == TEXT("play"))
		{
			FPatterPlayRequest Request;
			if (!Msg->TryGetStringField(TEXT("id"), Request.Id) || Request.Id.IsEmpty()
				|| !Msg->TryGetStringField(TEXT("sceneId"), Request.SceneId) || Request.SceneId.IsEmpty()
				|| !Msg->TryGetStringField(TEXT("blockId"), Request.BlockId) || Request.BlockId.IsEmpty())
			{
				return;
			}
			Msg->TryGetBoolField(TEXT("takeOver"), Request.bTakeOver);
			Msg->TryGetStringField(TEXT("build"), Request.Build);
			if (!Self->OnPlay)
			{
				FPatterPlayResult Unhandled;
				Unhandled.Reason = TEXT("unhandled");
				Self->ReplyPlay(Request.Id, Unhandled);
				return;
			}
			Self->OnPlay(Request);
		}
	});
	// The editor is not listening, or it went away: try again later (HandleGone).
	Socket->OnConnectionError().AddLambda([Weak, Mine](const FString&)
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleGone(-1);
	});
	Socket->OnClosed().AddLambda([Weak, Mine](int32 StatusCode, const FString&, bool)
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (Self.IsValid() && Self->Socket.Get() == Mine) Self->HandleGone(StatusCode);
	});
	Socket->Connect();
}

void FPatterDebugLink::HandleConnected()
{
	if (bClosed) return;
	bOpen = true;
	// Handshake first, so the editor can verify the build + seed the flow list before frames. On a
	// reconnect it's the same hello, with the build and the flows open now.
	Send(HelloMessage());
	RetryWait = RetryFirst;
	if (bLost)
	{
		bLost = false;
		UE_LOG(LogPatterplay, Log, TEXT("Patterplay: Live Link is back (%s)."), *DialUrl);
	}
	Flush();
}

// The socket closed, or never opened. Retry while the link is open, unless the editor replaced it with
// another game. One line when an established link is lost, none per attempt, and nothing at all for a
// link that has never opened.
void FPatterDebugLink::HandleGone(int32 StatusCode)
{
	if (bClosed || RetryAt > 0.0) return;   // closed, or this attempt was already counted
	const bool bWasOpen = bOpen;
	bOpen = false;
	// The startup queue only holds frames for the first socket; once that's gone, a frame with no open
	// socket has nowhere to go, so it is dropped rather than kept for the rest of the game.
	bStartup = false;
	Queue.Reset();
	if (StatusCode == CloseReplaced)
	{
		bClosed = true;
		UE_LOG(LogPatterplay, Log, TEXT("Patterplay: Live Link: another game took the editor's link (%s)."), *DialUrl);
		return;
	}
	if (bWasOpen && !bLost)
	{
		bLost = true;
		UE_LOG(LogPatterplay, Log, TEXT("Patterplay: Live Link lost (%s); retrying."), *DialUrl);
	}
	RetryAt = FPlatformTime::Seconds() + RetryWait;
	RetryWait = FMath::Min(RetryWait * 2.0, RetryMax);
	if (!RetryTicker.IsValid())
	{
		// One ticker for the link's life, made the first time it's needed: it looks at the clock and
		// dials when an attempt is due, so a retry allocates nothing but its socket.
		TWeakPtr<FPatterDebugLink> Weak = AsShared();
		RetryTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Weak](float)
		{
			TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
			if (!Self.IsValid()) return false;
			Self->RetryTick();
			return true;
		}), RetryTickInterval);
	}
}

void FPatterDebugLink::RetryTick()
{
	if (bClosed || RetryAt <= 0.0 || FPlatformTime::Seconds() < RetryAt) return;
	RetryAt = 0.0;
	Connect();
}

void FPatterDebugLink::FlowOpened(const FString& FlowId)
{
	Flows.Add(FlowId);
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("flowOpen"));
	Msg->SetStringField(TEXT("flow"), FlowId);
	Post(SerializeJson(Msg));
}

void FPatterDebugLink::FlowClosed(const FString& FlowId)
{
	Flows.Remove(FlowId);
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("flowClose"));
	Msg->SetStringField(TEXT("flow"), FlowId);
	Post(SerializeJson(Msg));
}

void FPatterDebugLink::Observe(const FString& FlowId, const FString& SceneId, const FString& BeatId, const FString& Type, const FString& ChoiceId)
{
	// A flow reports itself: FlowOpened is the host's job and nothing could check it, so a game that
	// forgot it left the editor's list short - and the omission survived a reconnect, because the
	// hello sends this set. Announce a flow we have not seen, then the frame.
	if (!Flows.Contains(FlowId)) FlowOpened(FlowId);

	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("frame"));
	Msg->SetStringField(TEXT("flow"), FlowId);
	// No scene (or no beat) goes as null, as the other runtimes' clients send it.
	if (SceneId.IsEmpty())
	{
		Msg->SetField(TEXT("sceneId"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Msg->SetStringField(TEXT("sceneId"), SceneId);
	}
	if (BeatId.IsEmpty())
	{
		Msg->SetField(TEXT("beatId"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Msg->SetStringField(TEXT("beatId"), BeatId);
	}
	Msg->SetStringField(TEXT("type"), Type);
	if (!ChoiceId.IsEmpty())
	{
		Msg->SetStringField(TEXT("choiceId"), ChoiceId);
	}
	Post(SerializeJson(Msg));
}

void FPatterDebugLink::ReplyPlay(const FString& Id, const FPatterPlayResult& Result)
{
	if (Id.IsEmpty()) return;
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("played"));
	Msg->SetStringField(TEXT("id"), Id);
	Msg->SetBoolField(TEXT("started"), Result.bStarted);
	if (!Result.Reason.IsEmpty()) Msg->SetStringField(TEXT("reason"), Result.Reason);
	if (!Result.Detail.IsEmpty()) Msg->SetStringField(TEXT("detail"), Result.Detail);
	Post(SerializeJson(Msg));
}

void FPatterDebugLink::SetBuild(const FString& Build)
{
	if (Build == BuildId) return;
	BuildId = Build;
	if (bOpen) Send(HelloMessage()); // re-handshake: the editor re-reads the build
}

FString FPatterDebugLink::State() const
{
	// While it waits to try again the link is still "connecting": "closed" is only Close() or replaced.
	if (bClosed) return TEXT("closed");
	return bOpen ? TEXT("connected") : TEXT("connecting");
}

void FPatterDebugLink::Close()
{
	bOpen = false;
	bClosed = true;
	RetryAt = 0.0;
	Queue.Reset();
	if (RetryTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(RetryTicker);
		RetryTicker.Reset();
	}
	if (Socket.IsValid())
	{
		Socket->Close();
	}
	DropSocket();
}

// Let go of the socket, unbinding it first so nothing it reports later reaches this link.
void FPatterDebugLink::DropSocket()
{
	if (!Socket.IsValid()) return;
	Socket->OnConnected().Clear();
	Socket->OnMessage().Clear();
	Socket->OnConnectionError().Clear();
	Socket->OnClosed().Clear();
	Socket.Reset();
}

void FPatterDebugLink::Post(const FString& Message)
{
	if (bClosed || (!bOpen && !bStartup)) return;
	Queue.Add(Message);
	Flush();
}

void FPatterDebugLink::Send(const FString& Message)
{
	if (SentForTest)
	{
		SentForTest->Add(Message);
	}
	else if (Socket.IsValid())
	{
		Socket->Send(Message);
	}
}

void FPatterDebugLink::Flush()
{
	if (!bOpen)
	{
		return;
	}
	for (const FString& Message : Queue)
	{
		Send(Message);
	}
	Queue.Reset();
}

FString FPatterDebugLink::HelloMessage() const
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("hello"));
	Msg->SetNumberField(TEXT("v"), 1);
	Msg->SetStringField(TEXT("build"), BuildId);
	Msg->SetStringField(TEXT("project"), Project);
	TArray<TSharedPtr<FJsonValue>> FlowArray;
	for (const FString& Flow : Flows)
	{
		FlowArray.Add(MakeShared<FJsonValueString>(Flow));
	}
	Msg->SetArrayField(TEXT("flows"), FlowArray);
	return SerializeJson(Msg);
}

#else // UE_BUILD_SHIPPING - the debug link compiles to nothing.

TSharedRef<FPatterDebugLink> FPatterDebugLink::Create(const FString& Build, const FString& Project, const FString& Url)
{
	return MakeShareable(new FPatterDebugLink(Build, Project, Url));
}

FPatterDebugLink::FPatterDebugLink(const FString& InBuild, const FString& InProject, const FString& InUrl)
	: BuildId(InBuild), Project(InProject), DialUrl(InUrl)
{
}

FPatterDebugLink::~FPatterDebugLink() {}
void FPatterDebugLink::FlowOpened(const FString&) {}
void FPatterDebugLink::FlowClosed(const FString&) {}
void FPatterDebugLink::Observe(const FString&, const FString&, const FString&, const FString&, const FString&) {}
void FPatterDebugLink::SetBuild(const FString&) {}
void FPatterDebugLink::ReplyPlay(const FString&, const FPatterPlayResult&) {}
void FPatterDebugLink::Close() {}
FString FPatterDebugLink::State() const { return TEXT("closed"); } // Shipping: the link is compiled out

#endif

// Outside the Shipping switch: a game's call to it compiles either way, as Observe's does.
FString FPatterDebugLink::TypeName(EPatterStepType Type)
{
	switch (Type)
	{
		case EPatterStepType::Line: return TEXT("line");
		case EPatterStepType::Text: return TEXT("text");
		case EPatterStepType::GameEvent: return TEXT("gameEvent");
		case EPatterStepType::Choice: return TEXT("choice");
		case EPatterStepType::End: return TEXT("end");
	}
	return TEXT("end");
}
