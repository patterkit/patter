#include "TourDemoActor.h"
#include "PatterEngine.h"
#include "PatterRunnerComponent.h"
#include "TourRunnerWidget.h"
#include "PatterBundle.h"
#include "PatterAudioResolver.h"
#include "PatterDebug.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundWaveProcedural.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/PlayerController.h"
#include "TimerManager.h"
#include "Styling/CoreStyle.h"
#include "Styling/SlateStyle.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Text/SRichTextBlock.h"
#include "Widgets/Input/SButton.h"

namespace
{
	const FLinearColor SpeakerColour(0.95f, 0.78f, 0.36f);
	const FLinearColor LineColour(0.92f, 0.92f, 0.92f);
	const FLinearColor NarrationColour(0.65f, 0.65f, 0.70f);
	const FLinearColor EventColour(0.35f, 0.80f, 0.85f);
	const FLinearColor PickedColour(0.45f, 0.85f, 0.45f);
	const FLinearColor NoticeColour(0.95f, 0.6f, 0.25f);

	// Patter's formatting markup is a fixed, flat vocabulary (<b>/<i>/<bi>); the runtime hands the
	// tags over verbatim and mapping them is the host's job. Slate's rich text uses the same
	// <name>...</> shape but closes every run with "</>", so the whole mapping is three replaces.
	FString ToRichText(const FString& In)
	{
		FString S = In;
		S.ReplaceInline(TEXT("</bi>"), TEXT("</>"));
		S.ReplaceInline(TEXT("</b>"), TEXT("</>"));
		S.ReplaceInline(TEXT("</i>"), TEXT("</>"));
		return S;
	}

	// The styles behind the tags. Colour is UseForeground so bold/italic runs inherit each
	// transcript line's colour (set on an SBorder around the line).
	const ISlateStyle& TourTextStyles()
	{
		static FSlateStyleSet Set("PatterTourText");
		static bool bInit = false;
		if (!bInit)
		{
			bInit = true;
			FTextBlockStyle Base = FCoreStyle::Get().GetWidgetStyle<FTextBlockStyle>("NormalText");
			Base.SetColorAndOpacity(FSlateColor::UseForeground());
			const auto WithFont = [&Base](const FSlateFontInfo& Font) { FTextBlockStyle S = Base; S.SetFont(Font); return S; };
			Set.Set("default", WithFont(FCoreStyle::GetDefaultFontStyle("Regular", 14)));
			Set.Set("b", WithFont(FCoreStyle::GetDefaultFontStyle("Bold", 14)));
			Set.Set("i", WithFont(FCoreStyle::GetDefaultFontStyle("Italic", 14)));
			Set.Set("bi", WithFont(FCoreStyle::GetDefaultFontStyle("BoldItalic", 14)));
		}
		return Set;
	}

	// A rich-text body: renders Patter's <b>/<i>/<bi> and inherits the surrounding foreground colour.
	TSharedRef<SWidget> RichBody(const FString& Text)
	{
		return SNew(SRichTextBlock)
			.Text(FText::FromString(ToRichText(Text)))
			.TextStyle(&TourTextStyles().GetWidgetStyle<FTextBlockStyle>("default"))
			.DecoratorStyleSet(&TourTextStyles())
			.AutoWrapText(true);
	}
}

ATourDemoActor::ATourDemoActor()
{
	PrimaryActorTick.bCanEverTick = false;
	Voice = CreateDefaultSubobject<UAudioComponent>(TEXT("Voice"));
	Voice->bAutoActivate = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Runner = CreateDefaultSubobject<UPatterRunnerComponent>(TEXT("Runner"));
}

void ATourDemoActor::BeginPlay()
{
	Super::BeginPlay();

	// A dialogue demo wants a cursor and clickable buttons, not game input.
	APlayerController* PC = GetWorld()->GetFirstPlayerController();
	if (PC)
	{
		PC->bShowMouseCursor = true;
		PC->SetInputMode(FInputModeUIOnly());
	}

	// Who shows the beats: the UMG example, which the demo only voices, or the Slate transcript.
	if (bUseUmgExample && PC)
	{
		UmgWidget = CreateWidget<UTourRunnerWidget>(PC, UTourRunnerWidget::StaticClass());
		UmgWidget->AddToViewport();
		UmgWidget->Bind(Runner);
		Runner->OnLine.AddDynamic(this, &ATourDemoActor::HandleVoice);
		Runner->OnText.AddDynamic(this, &ATourDemoActor::HandleVoice);
	}
	else
	{
		BuildUi();
		Runner->OnLine.AddDynamic(this, &ATourDemoActor::HandleLine);
		Runner->OnText.AddDynamic(this, &ATourDemoActor::HandleText);
		Runner->OnGameEvent.AddDynamic(this, &ATourDemoActor::HandleGameEvent);
		Runner->OnChoice.AddDynamic(this, &ATourDemoActor::HandleChoice);
		Runner->OnEnded.AddDynamic(this, &ATourDemoActor::HandleEnded);
	}

	// The bundle: an assigned asset wins; otherwise load the .patterc shipped beside the project.
	if (!Bundle)
	{
		const FString Path = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir(), BundleFile);
		FString Json;
		if (FFileHelper::LoadFileToString(Json, *Path))
			LoadedBundle = UPatterBundle::LoadFromString(Json);
		if (!LoadedBundle)
		{
			AddLine(TEXT(""), FString::Printf(TEXT("TourDemo: could not load '%s'."), *Path), NoticeColour);
			return;
		}
	}

	// The manifest is optional: without it the tour plays silently. Empty AudioRoot probes the
	// PatterKit repo's shared takes (this project sits at ports/unreal/PatterplayDemo there);
	// in the release zip that folder simply doesn't exist.
	FString Root = AudioRoot.IsEmpty() ? TEXT("../../../examples/projects/audio") : AudioRoot;
	Root = FPaths::IsRelative(Root) ? FPaths::ConvertRelativePathToFull(FPaths::ProjectDir(), Root) : Root;
	FString ManifestJson;
	if (FFileHelper::LoadFileToString(ManifestJson, *(Root / TEXT("patteraudio.json"))))
		Audio = UPatterAudioResolver::Create(ManifestJson, Root);

	StartTour();
}

void ATourDemoActor::EndPlay(const EEndPlayReason::Type Reason)
{
	if (RootWidget.IsValid() && GetWorld() && GetWorld()->GetGameViewport())
		GetWorld()->GetGameViewport()->RemoveViewportWidgetContent(RootWidget.ToSharedRef());
	RootWidget.Reset();
	if (UmgWidget) UmgWidget->RemoveFromParent();
	UmgWidget = nullptr;
	Super::EndPlay(Reason);
}

void ATourDemoActor::BuildUi()
{
	// A centred dark panel: the transcript scrolls in reading order, the choice buttons sit under it.
	RootWidget =
		SNew(SOverlay)
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Fill).Padding(0.f, 40.f)
		[
			SNew(SBox).WidthOverride(720.f)
			[
				SNew(SBorder)
				.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
				.BorderBackgroundColor(FLinearColor(0.02f, 0.02f, 0.03f, 0.92f))
				.Padding(24.f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 0.f, 0.f, 12.f)
					[
						SNew(STextBlock)
						.Text(NSLOCTEXT("TourDemo", "Title", "PATTER TOUR"))
						.Font(FCoreStyle::GetDefaultFontStyle("Bold", 13))
						.ColorAndOpacity(FSlateColor(NarrationColour))
					]
					+ SVerticalBox::Slot().FillHeight(1.f)
					[
						SAssignNew(Transcript, SScrollBox)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 14.f, 0.f, 0.f)
					[
						SAssignNew(ChoiceBox, SVerticalBox)
					]
				]
			]
		];
	if (UGameViewportClient* Viewport = GetWorld()->GetGameViewport())
		Viewport->AddViewportWidgetContent(RootWidget.ToSharedRef(), 10);
}

void ATourDemoActor::StartTour()
{
	GetWorldTimerManager().ClearTimer(StepTimer);
	if (Transcript.IsValid()) Transcript->ClearChildren();
	ClearChoices();

	Engine = UPatterEngine::Create(Bundle ? Bundle : LoadedBundle, {});
	if (!Engine) { AddLine(TEXT(""), TEXT("TourDemo: the bundle did not parse."), NoticeColour); return; }
	FPatterDebug::Register(Engine, TEXT("Tour demo")); // visible in Window > Patterplay Runtime State
	Runner->SetEngine(Engine, TEXT("main"));
	const FString Refusal = Runner->Begin();   // the project's start scene; the first beat arrives at once
	if (!Refusal.IsEmpty()) AddLine(TEXT(""), FString::Printf(TEXT("TourDemo: %s"), *Refusal), NoticeColour);
}

void ATourDemoActor::Advance()
{
	Runner->Next();
}

void ATourDemoActor::HoldThenAdvance(float Hold)
{
	GetWorldTimerManager().SetTimer(StepTimer, this, &ATourDemoActor::Advance, Hold, false);
}

void ATourDemoActor::HandleLine(const FPatterStep& Step)
{
	// The speaker's label is the name to show, a qualifier included (TAM (O.S.)), already put together
	// and translated; an IDs-only build has none, so the token stands in.
	const FString Speaker = (Step.bHasSpeakerLabel ? Step.SpeakerLabel : Step.Character).ToUpper();
	AddLine(Speaker, Step.Text, LineColour);
	const float Clip = PlayClip(Step.Id);
	HoldThenAdvance(Clip > 0.f ? Clip + 0.25f : StepDelay); // a voiced line holds for its take
}

void ATourDemoActor::HandleText(const FPatterStep& Step)
{
	AddLine(TEXT(""), Step.Text, NarrationColour);
	const float Clip = PlayClip(Step.Id);
	HoldThenAdvance(Clip > 0.f ? Clip + 0.25f : StepDelay);
}

void ATourDemoActor::HandleGameEvent(const FPatterStep& Step)
{
	AddLine(TEXT(""), FString::Printf(TEXT("[game event] %s"), *Step.Id), EventColour);
	HoldThenAdvance(StepDelay);
}

void ATourDemoActor::HandleVoice(const FPatterStep& Step)
{
	PlayClip(Step.Id);
}

void ATourDemoActor::HandleEnded(EPatterEndReason Reason)
{
	AddLine(TEXT(""), TEXT("The End"), NoticeColour);
	// Offer another run: the tour branches, so a replay actually differs.
	ChoiceBox->AddSlot().AutoHeight().Padding(0.f, 4.f)
	[
		SNew(SButton)
		.HAlign(HAlign_Center)
		.OnClicked(FOnClicked::CreateWeakLambda(this, [this]() { ClearChoices(); StartTour(); return FReply::Handled(); }))
		[
			SNew(STextBlock)
			.Text(NSLOCTEXT("TourDemo", "Replay", "Play again"))
			.Font(FCoreStyle::GetDefaultFontStyle("Bold", 14))
		]
	];
}

void ATourDemoActor::HandleChoice(const FString& GroupId, const TArray<FPatterOption>& Options)
{
	// The player clicks; OnChoose hands the pick to the runner.
	ClearChoices();
	bool bAny = false;
	for (const FPatterOption& O : Options)
	{
		bAny |= O.bEligible;
		ChoiceBox->AddSlot().AutoHeight().Padding(0.f, 3.f)
		[
			SNew(SButton)
			.IsEnabled(O.bEligible)
			.HAlign(HAlign_Left)
			.ContentPadding(FMargin(12.f, 7.f))
			.OnClicked(FOnClicked::CreateWeakLambda(this, [this, Id = O.Id, Text = O.Prompt.Text]()
			{
				OnChoose(Id, Text);
				return FReply::Handled();
			}))
			[
				RichBody(O.Prompt.Text)   // options can carry <b>/<i>/<bi> too
			]
		];
	}
	if (!bAny)
	{
		// No eligible option: the flow gathers past the choice on the next Next.
		AddLine(TEXT(""), TEXT("(no eligible option - the choice falls through)"), NoticeColour);
		HoldThenAdvance(StepDelay);
	}
}

void ATourDemoActor::OnChoose(const FString& OptionId, const FString& OptionText)
{
	ClearChoices();
	AddLine(TEXT(""), FString::Printf(TEXT("> %s"), *OptionText), PickedColour);
	// A short beat after the pick, then the runner plays what it leads to.
	GetWorldTimerManager().SetTimer(StepTimer, FTimerDelegate::CreateWeakLambda(this, [this, OptionId]() { Runner->Choose(OptionId); }), 0.35f, false);
}

void ATourDemoActor::ClearChoices()
{
	if (ChoiceBox.IsValid()) ChoiceBox->ClearChildren();
}

void ATourDemoActor::AddLine(const FString& Speaker, const FString& Text, const FLinearColor& Colour)
{
	UE_LOG(LogTemp, Display, TEXT("%s%s%s"), *Speaker, Speaker.IsEmpty() ? TEXT("") : TEXT("  "), *Text);
	if (!Transcript.IsValid()) return;   // the UMG example shows the beats itself
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	if (!Speaker.IsEmpty())
	{
		Row->AddSlot().AutoWidth().Padding(0.f, 0.f, 10.f, 0.f)
		[
			SNew(STextBlock)
			.Text(FText::FromString(Speaker))
			.Font(FCoreStyle::GetDefaultFontStyle("Bold", 14))
			.ColorAndOpacity(FSlateColor(SpeakerColour))
		];
	}
	// The border carries the line's colour; the rich-text runs (default/b/i/bi) inherit it.
	Row->AddSlot().FillWidth(1.f)[RichBody(Text)];
	Transcript->AddSlot().Padding(0.f, 4.f)
	[
		SNew(SBorder)
		.BorderImage(FCoreStyle::Get().GetBrush("NoBorder"))
		.Padding(0.f)
		.ForegroundColor(FSlateColor(Colour))
		[Row]
	];
	Transcript->ScrollToEnd();
}

float ATourDemoActor::PlayClip(const FString& BeatId)
{
	if (!Audio || !bPlayAudio) return 0.f;
	const FString Path = Audio->Resolve(BeatId);
	if (Path.IsEmpty()) return 0.f;

	// Minimal runtime WAV loader: 16-bit PCM only (what Patterpad's takes are). Anything else is
	// skipped with a log - a real game would route resolved paths into its own audio pipeline.
	TArray<uint8> Bytes;
	if (!FFileHelper::LoadFileToArray(Bytes, *Path) || Bytes.Num() < 44) return 0.f;
	auto U16 = [&Bytes](int32 At) { return static_cast<uint16>(Bytes[At] | (Bytes[At + 1] << 8)); };
	auto U32 = [&Bytes](int32 At) { return static_cast<uint32>(Bytes[At] | (Bytes[At + 1] << 8) | (Bytes[At + 2] << 16) | (Bytes[At + 3] << 24)); };
	if (FMemory::Memcmp(Bytes.GetData(), "RIFF", 4) != 0 || FMemory::Memcmp(Bytes.GetData() + 8, "WAVE", 4) != 0) return 0.f;

	// Walk the chunks for fmt + data (Patterpad writes canonical files, but be tolerant of extras).
	uint16 Channels = 0, BitsPerSample = 0; uint32 SampleRate = 0; int32 DataAt = -1; uint32 DataLen = 0;
	for (int32 At = 12; At + 8 <= Bytes.Num();)
	{
		const uint32 ChunkLen = U32(At + 4);
		if (FMemory::Memcmp(Bytes.GetData() + At, "fmt ", 4) == 0 && At + 8 + 16 <= Bytes.Num())
		{
			const uint16 Format = U16(At + 8);
			Channels = U16(At + 10); SampleRate = U32(At + 12); BitsPerSample = U16(At + 22);
			if (Format != 1) { UE_LOG(LogTemp, Warning, TEXT("TourDemo: %s is not plain PCM - skipping clip"), *Path); return 0.f; }
		}
		else if (FMemory::Memcmp(Bytes.GetData() + At, "data", 4) == 0) { DataAt = At + 8; DataLen = ChunkLen; }
		At += 8 + static_cast<int32>(ChunkLen) + (ChunkLen & 1);
	}
	if (DataAt < 0 || BitsPerSample != 16 || Channels == 0 || SampleRate == 0) return 0.f;
	DataLen = FMath::Min(DataLen, static_cast<uint32>(Bytes.Num() - DataAt));

	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
	Wave->SetSampleRate(SampleRate);
	Wave->NumChannels = Channels;
	Wave->Duration = static_cast<float>(DataLen) / (SampleRate * Channels * 2);
	Wave->SoundGroup = SOUNDGROUP_Voice;
	Wave->bLooping = false;
	Wave->QueueAudio(Bytes.GetData() + DataAt, DataLen);

	Voice->Stop();
	Voice->SetSound(Wave);
	Voice->Play();
	return Wave->Duration;
}
