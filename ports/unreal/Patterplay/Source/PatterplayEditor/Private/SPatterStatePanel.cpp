#include "SPatterStatePanel.h"

#include "PatterDebug.h"
#include "PatterEngine.h"
#include "PatterTypes.h"

#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SCheckBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SNumericEntryBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SBox.h"
#include "Styling/CoreStyle.h"

#define LOCTEXT_NAMESPACE "PatterStatePanel"

void SPatterStatePanel::Construct(const FArguments& InArgs)
{
	ChildSlot
	[
		SNew(SScrollBox)
		+ SScrollBox::Slot()
		[
			SAssignNew(Body, SVerticalBox)
		]
	];

	ChangedHandle = FPatterDebug::OnChanged().AddSP(this, &SPatterStatePanel::Rebuild);
	Rebuild();

	// Poll a few times a second: cheap Signature() check, only a real Rebuild() on a structural change.
	RegisterActiveTimer(0.25f, FWidgetActiveTimerDelegate::CreateSP(this, &SPatterStatePanel::OnRefresh));
}

SPatterStatePanel::~SPatterStatePanel()
{
	FPatterDebug::OnChanged().Remove(ChangedHandle);
}

EActiveTimerReturnType SPatterStatePanel::OnRefresh(double, float)
{
	if (Signature() != LastSignature)
	{
		Rebuild();
	}
	return EActiveTimerReturnType::Continue;
}

FString SPatterStatePanel::Signature() const
{
	FString S;
	for (const FPatterDebug::FEntry& E : FPatterDebug::List())
	{
		S += E.Label + TEXT("|");
		if (UPatterEngine* Engine = E.Engine.Get())
		{
			for (const FPatterPropertyRow& R : Engine->ListProperties())
			{
				S += R.Ref + TEXT(",");
			}
		}
		S += TEXT(";");
	}
	return S;
}

void SPatterStatePanel::Rebuild()
{
	if (!Body.IsValid())
	{
		return;
	}
	Body->ClearChildren();
	EnumSources.Reset();
	LastSignature = Signature();

	TArray<FPatterDebug::FEntry> Entries = FPatterDebug::List();
	if (Entries.Num() == 0)
	{
		Body->AddSlot().AutoHeight().Padding(10.f)
		[
			SNew(STextBlock)
			.AutoWrapText(true)
			.Text(LOCTEXT("NoEngines",
				"No live engines. In Play mode, call RegisterForDebug(\"label\") on your UPatterEngine "
				"(or FPatterDebug::Register) after creating it, and its @patter properties appear here."))
		];
		return;
	}

	for (const FPatterDebug::FEntry& E : Entries)
	{
		UPatterEngine* Engine = E.Engine.Get();
		if (!Engine)
		{
			continue;
		}

		Body->AddSlot().AutoHeight().Padding(10.f, 10.f, 10.f, 2.f)
		[
			SNew(STextBlock)
			.Text(FText::FromString(E.Label))
			.Font(FCoreStyle::GetDefaultFontStyle("Bold", 11))
		];
		Body->AddSlot().AutoHeight().Padding(10.f, 0.f, 10.f, 4.f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("PatterSection", "@patter properties"))
			.ColorAndOpacity(FSlateColor::UseSubduedForeground())
		];

		TArray<FPatterPropertyRow> Rows = Engine->ListProperties();
		if (Rows.Num() == 0)
		{
			Body->AddSlot().AutoHeight().Padding(16.f, 0.f, 10.f, 6.f)
			[
				SNew(STextBlock).Text(LOCTEXT("None", "(none)"))
			];
			continue;
		}
		for (const FPatterPropertyRow& Row : Rows)
		{
			Body->AddSlot().AutoHeight().Padding(14.f, 1.f, 10.f, 1.f)
			[
				BuildRow(Engine, Row)
			];
		}
	}
}

TSharedRef<SWidget> SPatterStatePanel::BuildRow(TWeakObjectPtr<UPatterEngine> Engine, const FPatterPropertyRow& Row)
{
	const FString Ref = Row.Ref;
	const FString DefaultStr = Row.Default;

	TSharedRef<SWidget> Editor = SNullWidget::NullWidget;

	switch (Row.Type)
	{
	case EPatterPropertyType::Boolean:
		Editor = SNew(SCheckBox)
			.IsChecked_Lambda([Engine, Ref]()
			{
				UPatterEngine* E = Engine.Get();
				return (E && E->GetPropertyBool(Ref)) ? ECheckBoxState::Checked : ECheckBoxState::Unchecked;
			})
			.OnCheckStateChanged_Lambda([Engine, Ref](ECheckBoxState State)
			{
				if (UPatterEngine* E = Engine.Get()) { E->SetPropertyBool(Ref, State == ECheckBoxState::Checked); }
			});
		break;

	case EPatterPropertyType::Number:
		Editor = SNew(SNumericEntryBox<float>)
			.AllowSpin(false)
			.Value_Lambda([Engine, Ref]() -> TOptional<float>
			{
				UPatterEngine* E = Engine.Get();
				return E ? TOptional<float>(E->GetPropertyNumber(Ref)) : TOptional<float>();
			})
			.OnValueCommitted_Lambda([Engine, Ref](float NewValue, ETextCommit::Type)
			{
				if (UPatterEngine* E = Engine.Get()) { E->SetPropertyNumber(Ref, NewValue); }
			});
		break;

	case EPatterPropertyType::Enum:
	{
		TSharedRef<TArray<TSharedPtr<FString>>> Options = MakeShared<TArray<TSharedPtr<FString>>>();
		for (const FString& V : Row.Values) { Options->Add(MakeShared<FString>(V)); }
		EnumSources.Add(Options);

		TSharedPtr<FString> Initial;
		if (UPatterEngine* E = Engine.Get())
		{
			const FString Cur = E->GetPropertyString(Ref);
			for (const TSharedPtr<FString>& O : *Options) { if (*O == Cur) { Initial = O; break; } }
		}

		Editor = SNew(SComboBox<TSharedPtr<FString>>)
			.OptionsSource(&(*Options))
			.InitiallySelectedItem(Initial)
			.OnGenerateWidget_Lambda([](TSharedPtr<FString> In)
			{
				return SNew(STextBlock).Text(FText::FromString(In.IsValid() ? *In : FString()));
			})
			.OnSelectionChanged_Lambda([Engine, Ref](TSharedPtr<FString> In, ESelectInfo::Type)
			{
				if (In.IsValid()) { if (UPatterEngine* E = Engine.Get()) { E->SetPropertyString(Ref, *In); } }
			})
			[
				SNew(STextBlock).Text_Lambda([Engine, Ref]()
				{
					UPatterEngine* E = Engine.Get();
					return FText::FromString(E ? E->GetPropertyString(Ref) : FString());
				})
			];
		break;
	}

	case EPatterPropertyType::Flags:
		Editor = SNew(SEditableTextBox)
			.HintText(LOCTEXT("FlagsHint", "comma, separated"))
			.Text_Lambda([Engine, Ref]()
			{
				UPatterEngine* E = Engine.Get();
				return E ? FText::FromString(FString::Join(E->GetPropertyFlags(Ref), TEXT(", "))) : FText::GetEmpty();
			})
			.OnTextCommitted_Lambda([Engine, Ref](const FText& Text, ETextCommit::Type)
			{
				UPatterEngine* E = Engine.Get();
				if (!E) { return; }
				TArray<FString> Parts;
				Text.ToString().ParseIntoArray(Parts, TEXT(","), true);
				for (FString& P : Parts) { P.TrimStartAndEndInline(); }
				Parts.RemoveAll([](const FString& S) { return S.IsEmpty(); });
				E->SetPropertyFlags(Ref, Parts);
			});
		break;

	default: // String (and any unrecognised type) -> a text field.
		Editor = SNew(SEditableTextBox)
			.Text_Lambda([Engine, Ref]()
			{
				UPatterEngine* E = Engine.Get();
				return E ? FText::FromString(E->GetPropertyString(Ref)) : FText::GetEmpty();
			})
			.OnTextCommitted_Lambda([Engine, Ref](const FText& Text, ETextCommit::Type)
			{
				if (UPatterEngine* E = Engine.Get()) { E->SetPropertyString(Ref, Text.ToString()); }
			});
		break;
	}

	const EPatterPropertyType Type = Row.Type;
	auto ResetToDefault = [Engine, Ref, DefaultStr, Type]()
	{
		UPatterEngine* E = Engine.Get();
		if (!E) { return FReply::Handled(); }
		switch (Type)
		{
		case EPatterPropertyType::Boolean: E->SetPropertyBool(Ref, DefaultStr == TEXT("true")); break;
		case EPatterPropertyType::Number:  E->SetPropertyNumber(Ref, FCString::Atof(*DefaultStr)); break;
		case EPatterPropertyType::Flags:
		{
			TArray<FString> Parts;
			DefaultStr.ParseIntoArray(Parts, TEXT(","), true);
			E->SetPropertyFlags(Ref, Parts);
			break;
		}
		default: E->SetPropertyString(Ref, DefaultStr); break; // String + Enum
		}
		return FReply::Handled();
	};

	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 8.f, 0.f)
		[
			SNew(SBox).WidthOverride(150.f)
			[
				SNew(STextBlock).Text(FText::FromString(Ref)).ToolTipText(FText::FromString(Ref))
			]
		]
		+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
		[
			Editor
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.f, 0.f, 0.f, 0.f)
		[
			SNew(SButton)
			.ToolTipText(LOCTEXT("ResetTip", "Reset to default"))
			.IsEnabled_Lambda([Engine, Ref, DefaultStr]()
			{
				UPatterEngine* E = Engine.Get();
				return E && E->GetPropertyString(Ref) != DefaultStr;
			})
			.OnClicked_Lambda(ResetToDefault)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("↺"))) // circular reset arrow
			]
		];
}

#undef LOCTEXT_NAMESPACE
