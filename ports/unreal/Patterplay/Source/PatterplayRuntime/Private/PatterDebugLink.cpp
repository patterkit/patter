#include "PatterDebugLink.h"

#if !UE_BUILD_SHIPPING

#include "WebSocketsModule.h"
#include "IWebSocket.h"
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
}

TSharedRef<FPatterDebugLink> FPatterDebugLink::Create(const FString& Build, const FString& Project, const FString& Url)
{
	TSharedRef<FPatterDebugLink> Link = MakeShareable(new FPatterDebugLink(Build, Project, Url));
	Link->Connect();
	return Link;
}

FPatterDebugLink::FPatterDebugLink(const FString& InBuild, const FString& InProject, const FString& InUrl)
	: BuildId(InBuild), Project(InProject), Url(InUrl)
{
}

FPatterDebugLink::~FPatterDebugLink()
{
	Close();
}

void FPatterDebugLink::Connect()
{
	if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
	{
		FModuleManager::Get().LoadModule("WebSockets");
	}
	Socket = FWebSocketsModule::Get().CreateWebSocket(Url, TEXT(""));
	if (!Socket.IsValid())
	{
		return;
	}

	TWeakPtr<FPatterDebugLink> Weak = AsShared();
	Socket->OnConnected().AddLambda([Weak]()
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (!Self.IsValid()) return;
		Self->bOpen = true;
		// Handshake first, so the editor can verify the build + seed the flow list before frames.
		Self->Socket->Send(Self->HelloMessage());
		Self->Flush();
	});
	// Live bundle refresh: the editor pushes {t:"bundle", build, data}. Validate the shape here so
	// the host's OnBundle never sees a malformed payload; anything else the editor sends is ignored.
	Socket->OnMessage().AddLambda([Weak](const FString& Message)
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (!Self.IsValid() || !Self->OnBundle) return;
		TSharedPtr<FJsonObject> Msg;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Message);
		if (!FJsonSerializer::Deserialize(Reader, Msg) || !Msg.IsValid()) return;
		FString Type, Build, Data;
		if (Msg->TryGetStringField(TEXT("t"), Type) && Type == TEXT("bundle")
			&& Msg->TryGetStringField(TEXT("build"), Build)
			&& Msg->TryGetStringField(TEXT("data"), Data))
		{
			Self->OnBundle(Build, Data);
		}
	});
	Socket->OnConnectionError().AddLambda([](const FString&) { /* editor not listening - stay a no-op */ });
	Socket->OnClosed().AddLambda([Weak](int32, const FString&, bool)
	{
		TSharedPtr<FPatterDebugLink> Self = Weak.Pin();
		if (Self.IsValid()) Self->bOpen = false;
	});
	Socket->Connect();
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
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("t"), TEXT("frame"));
	Msg->SetStringField(TEXT("flow"), FlowId);
	Msg->SetStringField(TEXT("sceneId"), SceneId);
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

void FPatterDebugLink::SetBuild(const FString& Build)
{
	if (Build == BuildId) return;
	BuildId = Build;
	if (bOpen && Socket.IsValid()) Socket->Send(HelloMessage()); // re-handshake: the editor re-reads the build
}

void FPatterDebugLink::Close()
{
	bOpen = false;
	Queue.Reset();
	if (Socket.IsValid())
	{
		Socket->Close();
		Socket.Reset();
	}
}

void FPatterDebugLink::Post(const FString& Message)
{
	Queue.Add(Message);
	Flush();
}

void FPatterDebugLink::Flush()
{
	if (!bOpen || !Socket.IsValid())
	{
		return;
	}
	for (const FString& Message : Queue)
	{
		Socket->Send(Message);
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
	: BuildId(InBuild), Project(InProject), Url(InUrl)
{
}

FPatterDebugLink::~FPatterDebugLink() {}
void FPatterDebugLink::FlowOpened(const FString&) {}
void FPatterDebugLink::FlowClosed(const FString&) {}
void FPatterDebugLink::Observe(const FString&, const FString&, const FString&, const FString&, const FString&) {}
void FPatterDebugLink::SetBuild(const FString&) {}
void FPatterDebugLink::Close() {}

#endif
