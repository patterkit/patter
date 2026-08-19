// The bundle inspector, Unreal idiom (design/from-storylets/patterplay-bundle-inspector.md): a
// details customisation on UPatterBundle, so selecting an imported .patterc in the Content Browser
// answers "what may my game code call?" without running the game or opening Patterpad.
//
// Read-only by construction: every row comes from patter::describeBundle (no engine, no state), and
// nothing here writes to the asset. The details panel's own categories are the collapsible sections
// - Bundle (identity), Addresses, Host properties, Story properties, Game data, Counts - with the
// load error surfaced at the top when the bundle failed to parse.
//
// Contrast SPatterStatePanel, which is the LIVE property examiner: it needs a running engine and
// edits what it shows. This needs neither and edits nothing.
//
// Slate idiom follows SPatterStatePanel: STextBlock rows, subdued foreground for headings.
#pragma once

#include "CoreMinimal.h"
#include "IDetailCustomization.h"

class IDetailLayoutBuilder;
class IDetailCategoryBuilder;

class FPatterBundleDetails : public IDetailCustomization
{
public:
	static TSharedRef<IDetailCustomization> MakeInstance();

	virtual void CustomizeDetails(IDetailLayoutBuilder& DetailBuilder) override;

private:
	/** One full-width text row in a category (headings and asides pass bMuted). */
	static void AddLine(IDetailCategoryBuilder& Category, const FString& Text, bool bMuted = false);
};
