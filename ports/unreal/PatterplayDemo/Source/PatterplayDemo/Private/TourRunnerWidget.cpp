#include "TourRunnerWidget.h"
#include "PatterRunnerComponent.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Styling/CoreStyle.h"

namespace
{
	UTextBlock* MakeText(UWidgetTree* Tree, const FString& Text, int32 Size, const FLinearColor& Colour)
	{
		UTextBlock* Block = Tree->ConstructWidget<UTextBlock>();
		Block->SetText(FText::FromString(Text));
		Block->SetFont(FCoreStyle::GetDefaultFontStyle("Regular", Size));
		Block->SetColorAndOpacity(FSlateColor(Colour));
		Block->SetAutoWrapText(true);
		return Block;
	}
}

void UTourChoiceButton::Offer(UPatterRunnerComponent* InRunner, const FString& InOptionId)
{
	Runner = InRunner;
	OptionId = InOptionId;
	OnClicked.AddUniqueDynamic(this, &UTourChoiceButton::HandleClicked);
}

void UTourChoiceButton::HandleClicked()
{
	if (Runner) Runner->Choose(OptionId);
}

TSharedRef<SWidget> UTourRunnerWidget::RebuildWidget()
{
	// The tree, built once: a dark panel at the foot of the screen holding the speaker, the line, Continue,
	// and the choice buttons.
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		UBorder* Root = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Root"));
		Root->SetBrushColor(FLinearColor::Transparent);
		Root->SetPadding(FMargin(80.f, 40.f));
		Root->SetHorizontalAlignment(HAlign_Center);
		Root->SetVerticalAlignment(VAlign_Bottom);
		WidgetTree->RootWidget = Root;

		UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Panel"));
		Panel->SetBrushColor(FLinearColor(0.02f, 0.02f, 0.03f, 0.92f));
		Panel->SetPadding(FMargin(24.f));
		Root->SetContent(Panel);

		UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Column"));
		Panel->SetContent(Column);

		SpeakerText = MakeText(WidgetTree, FString(), 14, FLinearColor(0.95f, 0.78f, 0.36f));
		LineText = MakeText(WidgetTree, FString(), 16, FLinearColor(0.92f, 0.92f, 0.92f));
		Column->AddChildToVerticalBox(SpeakerText);
		Column->AddChildToVerticalBox(LineText)->SetPadding(FMargin(0.f, 6.f, 0.f, 12.f));

		ContinueButton = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), TEXT("Continue"));
		ContinueButton->SetContent(MakeText(WidgetTree, TEXT("Continue"), 14, FLinearColor::Black));
		ContinueButton->OnClicked.AddUniqueDynamic(this, &UTourRunnerWidget::HandleContinue);
		Column->AddChildToVerticalBox(ContinueButton)->SetHorizontalAlignment(HAlign_Right);

		ChoiceList = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Choices"));
		Column->AddChildToVerticalBox(ChoiceList);
	}
	return Super::RebuildWidget();
}

void UTourRunnerWidget::Bind(UPatterRunnerComponent* InRunner)
{
	Runner = InRunner;
	if (!Runner) return;
	// A line, a text and a game event all show the same way here: one beat, then Continue.
	Runner->OnLine.AddUniqueDynamic(this, &UTourRunnerWidget::HandleBeat);
	Runner->OnText.AddUniqueDynamic(this, &UTourRunnerWidget::HandleBeat);
	Runner->OnGameEvent.AddUniqueDynamic(this, &UTourRunnerWidget::HandleBeat);
	Runner->OnChoice.AddUniqueDynamic(this, &UTourRunnerWidget::HandleChoice);
	Runner->OnEnded.AddUniqueDynamic(this, &UTourRunnerWidget::HandleEnded);
}

void UTourRunnerWidget::Show(const FString& Speaker, const FString& Text)
{
	if (SpeakerText) SpeakerText->SetText(FText::FromString(Speaker));
	if (LineText) LineText->SetText(FText::FromString(Text));
}

void UTourRunnerWidget::HandleBeat(const FPatterStep& Step)
{
	if (ChoiceList) ChoiceList->ClearChildren();
	switch (Step.Type)
	{
		case EPatterStepType::Line:
			// The speaker's label is the name to show, already put together and translated; an IDs-only build
			// has none, so the token stands in.
			Show((Step.bHasSpeakerLabel ? Step.SpeakerLabel : Step.Character).ToUpper(), Step.Text);
			break;
		case EPatterStepType::GameEvent:
			Show(FString(), FString::Printf(TEXT("[game event] %s"), *Step.Id));
			break;
		default:
			Show(FString(), Step.Text);
			break;
	}
	if (ContinueButton) ContinueButton->SetVisibility(ESlateVisibility::Visible);
}

void UTourRunnerWidget::HandleChoice(const FString& GroupId, const TArray<FPatterOption>& Options)
{
	if (ContinueButton) ContinueButton->SetVisibility(ESlateVisibility::Collapsed);
	if (!ChoiceList || !WidgetTree) return;
	ChoiceList->ClearChildren();
	bool bAny = false;
	for (const FPatterOption& Option : Options)
	{
		bAny |= Option.bEligible;
		UTourChoiceButton* Button = WidgetTree->ConstructWidget<UTourChoiceButton>(UTourChoiceButton::StaticClass());
		Button->SetContent(MakeText(WidgetTree, Option.Prompt.Text, 14, FLinearColor::Black));
		Button->SetIsEnabled(Option.bEligible);
		Button->Offer(Runner, Option.Id);
		ChoiceList->AddChildToVerticalBox(Button)->SetPadding(FMargin(0.f, 3.f));
	}
	// No eligible option: the flow gathers past the choice on the next Next, so Continue does it.
	if (!bAny && ContinueButton) ContinueButton->SetVisibility(ESlateVisibility::Visible);
}

void UTourRunnerWidget::HandleEnded()
{
	if (ChoiceList) ChoiceList->ClearChildren();
	if (ContinueButton) ContinueButton->SetVisibility(ESlateVisibility::Collapsed);
	Show(FString(), TEXT("- The End -"));
}

void UTourRunnerWidget::HandleContinue()
{
	if (Runner) Runner->Next();
}
