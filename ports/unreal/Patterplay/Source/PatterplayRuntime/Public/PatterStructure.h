// Blueprint-facing types for static structure introspection: a read-only view of the AUTHORED tree
// (scenes -> blocks -> groups/snippets -> beats), for editor / dev tooling that builds against the
// writer's structure (e.g. a Sequencer of subsequences per beat). Mirrors @patterkit/runtime's
// BeatInfo / OutlineNode / OutlineScene / FlatBeat. See UPatterEngine::GetOutline / GetBeatSequence.
#pragma once

#include "CoreMinimal.h"
#include "PatterTypes.h"   // EPatterPropertyType (reused for gameData value types)
#include "PatterStructure.generated.h"

UENUM(BlueprintType)
enum class EPatterBeatKind : uint8
{
	Line,
	Text,
	GameEvent
};

// FPatterGameDataEntry lives in PatterTypes.h (included above): delivered steps carry it too.

/** One beat's static data - the same shape a delivered step carries, read at the source locale. */
USTRUCT(BlueprintType)
struct FPatterBeatInfo
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterBeatKind Kind = EPatterBeatKind::Line;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Character;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Direction;

	/** Source text, un-interpolated (line / text). Empty for gameEvent and IDs-only bundles. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Text;

	/** Author gameData overrides on this beat (raw, as the step carries them). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	/** Accumulated author tags (scene -> block -> group(s) -> snippet -> beat). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;
};

// A node in the outline tree: a group (selector + children) or a snippet (beats + jump). Blueprint
// USTRUCTs cannot nest a struct inside itself, so the tree is stored FLAT on the block (Nodes) and
// linked by index: a group's ChildIndices point into that same Nodes array. See FPatterOutlineBlock.
USTRUCT(BlueprintType)
struct FPatterOutlineNode
{
	GENERATED_BODY()

	/** "group" or "snippet". */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Type;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;

	// --- group only ---
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Selector;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasPrompt = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterBeatInfo Prompt;

	/** A group's children, as indices into the enclosing block's Nodes array. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<int32> ChildIndices;

	// --- snippet only ---
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterBeatInfo> Beats;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString JumpTo;

	/** "jump" (absolute) or "call" (jump-and-return); empty when the snippet has no jump. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString JumpMode;
};

USTRUCT(BlueprintType)
struct FPatterOutlineBlock
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;

	/** Every node in this block, flat (depth-first). The tree is linked by index (RootIndices +
	    each group node's ChildIndices), since a Blueprint USTRUCT can't nest itself. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterOutlineNode> Nodes;

	/** The block's top-level nodes, as indices into Nodes. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<int32> RootIndices;
};

USTRUCT(BlueprintType)
struct FPatterOutlineScene
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterOutlineBlock> Blocks;
};

/** One beat in document order, with the scene/block/snippet it lives in (the flat view). */
USTRUCT(BlueprintType)
struct FPatterFlatBeat
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString SceneId;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString BlockId;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString SnippetId;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterBeatInfo Beat;
};
