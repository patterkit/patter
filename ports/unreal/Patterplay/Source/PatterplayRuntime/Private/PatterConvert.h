// The conversions the UObject layer makes between the std core and Unreal, once: strings both ways, and a
// Patter value both ways across the Blueprint boundary. Every file in this module that needs one includes
// this rather than defining its own, which is what kept the module out of unity builds: a merged
// translation unit saw the same file-local helper defined several times over.
#pragma once

#include "CoreMinimal.h"
#include "PatterTypes.h"
#include "Patter/PatterValue.h"
#include "Patter/Bundle.h"     // NodeExtensions, ExtensionValues
#include "Patter/JsonTree.h"   // jsonText

#include <string>
#include <vector>

namespace PatterConvert
{
	inline std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
	inline FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	/** A core value as Blueprint sees it. Display is the core's own rendering. */
	inline FPatterValue ToUeValue(const patter::PatterValue& V)
	{
		FPatterValue Out;
		if (V.isNumber()) { Out.Kind = EPatterValueKind::Number; Out.Number = V.n; }
		else if (V.isString()) { Out.Kind = EPatterValueKind::String; Out.String = Ue(V.s); }
		else if (V.isFlags()) { Out.Kind = EPatterValueKind::Flags; for (const std::string& F : V.f) Out.Flags.Add(Ue(F)); }
		else { Out.Kind = EPatterValueKind::Boolean; Out.bBool = V.b; }
		Out.Display = Ue(V.toDisplayString());
		return Out;
	}

	/** A Blueprint value as the core takes it. Display is ignored on the way in. */
	inline patter::PatterValue FromUeValue(const FPatterValue& V)
	{
		switch (V.Kind)
		{
			case EPatterValueKind::Number: return patter::PatterValue::Num(V.Number);
			case EPatterValueKind::String: return patter::PatterValue::Str(Std(V.String));
			case EPatterValueKind::Flags:
			{
				std::vector<std::string> Flags;
				for (const FString& F : V.Flags) Flags.push_back(Std(F));
				return patter::PatterValue::Flags(std::move(Flags));
			}
			default: return patter::PatterValue::Bool(V.bBool);
		}
	}

	/** One Patter extension's values on a node, each as strict JSON text, in bundle order. */
	inline TArray<FPatterExtensionEntry> ToUeExtensionEntries(const patter::ExtensionValues& Values)
	{
		TArray<FPatterExtensionEntry> Out;
		Out.Reserve(static_cast<int32>(Values.size()));
		for (const auto& Pair : Values)
		{
			FPatterExtensionEntry Entry;
			Entry.Name = Ue(Pair.first);
			Entry.Json = Ue(patter::jsonText(Pair.second));
			Out.Add(MoveTemp(Entry));
		}
		return Out;
	}

	/** A node's Patter extension values, one entry per extension, in bundle order. */
	inline TArray<FPatterExtensionValues> ToUeExtensions(const patter::NodeExtensions& Extensions)
	{
		TArray<FPatterExtensionValues> Out;
		Out.Reserve(static_cast<int32>(Extensions.size()));
		for (const auto& Pair : Extensions)
		{
			FPatterExtensionValues Values;
			Values.Extension = Ue(Pair.first);
			Values.Values = ToUeExtensionEntries(Pair.second);
			Out.Add(MoveTemp(Values));
		}
		return Out;
	}
}
