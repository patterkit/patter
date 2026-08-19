#include "PatterBundleDetails.h"

#include "PatterBundle.h"
#include "Patter/Describe.h"

#include "DetailCategoryBuilder.h"
#include "DetailLayoutBuilder.h"
#include "DetailWidgetRow.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Text/STextBlock.h"

#define LOCTEXT_NAMESPACE "PatterBundleDetails"

namespace
{
	FString Utf8(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	/** A declaration line. "(no default)" is the part an integrator is scanning for: it is the value
	 *  the host must supply, or a condition reads the type default and a branch never fires. */
	FString PropertyLabel(const patter::PropertySummary& P)
	{
		return FString::Printf(TEXT("%s   %s%s"), *Utf8(P.name), *Utf8(P.type),
			P.hasDefault ? TEXT("") : TEXT("   (no default)"));
	}
}

TSharedRef<IDetailCustomization> FPatterBundleDetails::MakeInstance()
{
	return MakeShared<FPatterBundleDetails>();
}

void FPatterBundleDetails::AddLine(IDetailCategoryBuilder& Category, const FString& Text, bool bMuted)
{
	Category.AddCustomRow(FText::FromString(Text))
	.WholeRowContent()
	[
		SNew(STextBlock)
		.Text(FText::FromString(Text))
		.ColorAndOpacity(bMuted ? FSlateColor::UseSubduedForeground() : FSlateColor::UseForeground())
	];
}

void FPatterBundleDetails::CustomizeDetails(IDetailLayoutBuilder& DetailBuilder)
{
	TArray<TWeakObjectPtr<UObject>> Objects;
	DetailBuilder.GetObjectsBeingCustomized(Objects);
	if (Objects.Num() != 1)
	{
		// Multi-select: the shape of one bundle is the only useful reading.
		return;
	}
	UPatterBundle* Asset = Cast<UPatterBundle>(Objects[0].Get());
	if (!Asset)
	{
		return;
	}

	IDetailCategoryBuilder& BundleCategory = DetailBuilder.EditCategory(
		TEXT("Bundle"), LOCTEXT("BundleCategory", "Bundle"), ECategoryPriority::Important);

	// A broken bundle still imports: say so first, and loudly.
	const patter::Bundle* Raw = Asset->Raw();
	if (!Raw)
	{
		const FString Why = Asset->LoadError.IsEmpty()
			? LOCTEXT("LoadErrorUnknown", "the bundle has not been parsed").ToString()
			: Asset->LoadError;
		BundleCategory.AddCustomRow(LOCTEXT("LoadErrorFilter", "Load error"))
		.WholeRowContent()
		[
			SNew(STextBlock)
			.AutoWrapText(true)
			.ColorAndOpacity(FLinearColor::Red)
			.Text(FText::Format(LOCTEXT("LoadErrorRow", "This bundle failed to load:\n{0}"),
				FText::FromString(Why)))
		];
		return;
	}

	const patter::BundleDescription D = patter::describeBundle(*Raw);

	// --- identity: which bundle is this? ---------------------------------------
	BundleCategory.AddCustomRow(LOCTEXT("IdentityFilter", "Identity"))
	.WholeRowContent()
	[
		SNew(STextBlock)
		.Font(FCoreStyle::GetDefaultFontStyle("Bold", 11))
		.Text(FText::FromString(D.identity.project.empty()
			? TEXT("(unnamed project)")
			: FString::Printf(TEXT("%s %s"), *Utf8(D.identity.project), *Utf8(D.identity.version))))
	];
	AddLine(BundleCategory, FString::Printf(TEXT("schema %s"), *Utf8(D.identity.schema)), true);
	{
		FString Locales = Utf8(D.identity.defaultLocale);
		if (D.identity.locales.size() > 1)
		{
			Locales += FString::Printf(TEXT("   (+%d)"), static_cast<int32>(D.identity.locales.size()) - 1);
		}
		AddLine(BundleCategory, FString::Printf(TEXT("locales %s   strings %s"),
			*Locales, *Utf8(D.identity.localisation)), true);
	}
	// Equal structure + a different hash means a TEXT-ONLY edit, which is what makes a live hot-swap
	// safe. Both are shown so those can be told apart at sight.
	AddLine(BundleCategory, FString::Printf(TEXT("hash %s   structure %s"),
		D.identity.hash.empty() ? TEXT("(none)") : *Utf8(D.identity.hash),
		D.identity.structureHash.empty() ? TEXT("(none)") : *Utf8(D.identity.structureHash)), true);
	// A source-debug build embeds the source language purely so it can be played. Shipping one is a
	// mistake otherwise visible only as "strings ids".
	if (D.identity.sourceDebug)
	{
		BundleCategory.AddCustomRow(LOCTEXT("SourceDebugFilter", "Source debug"))
		.WholeRowContent()
		[
			SNew(STextBlock)
			.AutoWrapText(true)
			.ColorAndOpacity(FLinearColor::Red)
			.Text(LOCTEXT("SourceDebugRow", "SOURCE DEBUG build: the strings are the source language, for debugging. Not shippable."))
		];
	}

	// --- addresses: what RunFlow / GotoAddress take ----------------------------
	IDetailCategoryBuilder& AddressCategory = DetailBuilder.EditCategory(
		TEXT("Addresses"), LOCTEXT("AddressCategory", "Addresses"));
	if (D.addresses.empty())
	{
		AddLine(AddressCategory, TEXT("(no scenes)"), true);
	}
	for (const patter::AddressSummary& A : D.addresses)
	{
		AddLine(AddressCategory, FString::Printf(TEXT("%s   %s"), *Utf8(A.gameId), *Utf8(A.name)));
		// Indented, because a block address is SCENE-SCOPED: the pair is the address, and a flat list
		// would invite calling one alone.
		for (const patter::BlockAddress& B : A.blocks)
		{
			AddLine(AddressCategory, FString::Printf(TEXT("    %s   %s"), *Utf8(B.gameId), *Utf8(B.name)), true);
		}
	}

	// --- host scopes: what the GAME must supply --------------------------------
	IDetailCategoryBuilder& HostCategory = DetailBuilder.EditCategory(
		TEXT("HostProperties"), LOCTEXT("HostCategory", "Host properties"));
	if (D.hostScopes.empty())
	{
		AddLine(HostCategory, TEXT("(the game supplies nothing)"), true);
	}
	for (const patter::HostScopeSummary& S : D.hostScopes)
	{
		FString Head = FString::Printf(TEXT("@%s: "), *Utf8(S.token));
		Head += S.opaque
			? TEXT("any name, unchecked")
			: FString::Printf(TEXT("%d declared"), static_cast<int32>(S.properties.size()));
		if (!S.writable)
		{
			Head += TEXT("   (read-only)");
		}
		AddLine(HostCategory, Head);
		for (const patter::PropertySummary& P : S.properties)
		{
			AddLine(HostCategory, TEXT("    ") + PropertyLabel(P));
		}
	}

	// --- story-owned declarations: orientation, not a calling surface -----------
	IDetailCategoryBuilder& OwnedCategory = DetailBuilder.EditCategory(
		TEXT("StoryProperties"), LOCTEXT("OwnedCategory", "Story properties"));
	if (D.properties.patter.empty() && D.properties.scene.empty())
	{
		AddLine(OwnedCategory, TEXT("(none declared)"), true);
	}
	for (const patter::PropertySummary& P : D.properties.patter)
	{
		AddLine(OwnedCategory, PropertyLabel(P));
	}
	for (const patter::SceneProperties& S : D.properties.scene)
	{
		AddLine(OwnedCategory, FString::Printf(TEXT("@scene %s"), *Utf8(S.gameId)));
		for (const patter::PropertySummary& P : S.properties)
		{
			AddLine(OwnedCategory, TEXT("    ") + PropertyLabel(P));
		}
	}

	// Only when there are some: an always-empty category teaches the reader to skip it.
	if (!D.gameData.empty())
	{
		IDetailCategoryBuilder& DataCategory = DetailBuilder.EditCategory(
			TEXT("GameData"), LOCTEXT("DataCategory", "Game data"));
		for (const patter::GameDataSummary& G : D.gameData)
		{
			AddLine(DataCategory, FString::Printf(TEXT("on %s"), *Utf8(G.kind)));
			for (const patter::GameDataFieldSummary& F : G.fields)
			{
				AddLine(DataCategory, FString::Printf(TEXT("    %s   %s"), *Utf8(F.name), *Utf8(F.type)), true);
			}
		}
	}

	// --- counts: "is this the right build?" ------------------------------------
	IDetailCategoryBuilder& CountCategory = DetailBuilder.EditCategory(
		TEXT("Counts"), LOCTEXT("CountCategory", "Counts"));
	AddLine(CountCategory, FString::Printf(TEXT("scenes %d   blocks %d   groups %d   snippets %d"),
		D.counts.scenes, D.counts.blocks, D.counts.groups, D.counts.snippets));
	// Beats is the population beatSequence walks; a choice prompt hangs off its group and is counted
	// separately rather than folded in or dropped.
	AddLine(CountCategory, FString::Printf(TEXT("beats %d   choice prompts %d   game events %d   cast %d"),
		D.counts.beats, D.counts.prompts, D.counts.gameEvents, D.counts.cast));
}

#undef LOCTEXT_NAMESPACE
