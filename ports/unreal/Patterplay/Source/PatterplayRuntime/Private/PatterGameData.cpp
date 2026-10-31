#include "PatterGameData.h"

#include "PatterBundle.h"
#include "PatterLog.h"
#include "Patter/Bundle.h"
#include "PatterConvert.h"

using namespace PatterConvert;

namespace
{
	EPatterPropertyType FieldType(const std::string& T)
	{
		if (T == "number") return EPatterPropertyType::Number;
		if (T == "boolean") return EPatterPropertyType::Boolean;
		if (T == "flags") return EPatterPropertyType::Flags;
		if (T == "enum") return EPatterPropertyType::Enum;
		if (T == "quality") return EPatterPropertyType::Quality;
		return EPatterPropertyType::String;
	}

	const FPatterGameDataEntry* Find(const TArray<FPatterGameDataEntry>& Node, const FString& Name)
	{
		return Node.FindByPredicate([&Name](const FPatterGameDataEntry& E) { return E.Name == Name; });
	}

	/** A gameData default as the neutral tree, for its JSON text. */
	patter::JsonTree ValueTree(const patter::PatterValue& V)
	{
		if (V.isNumber()) return patter::JsonTree::makeNumber(V.n);
		if (V.isString()) return patter::JsonTree::makeString(V.s);
		if (V.isFlags())
		{
			patter::JsonTree Out = patter::JsonTree::makeArray();
			for (const std::string& F : V.f) Out.arr.push_back(patter::JsonTree::makeString(F));
			return Out;
		}
		return patter::JsonTree::makeBool(V.b);
	}

	/** A JSON scalar as a Patter value, as the bundle reader reads a gameData value. False for a record, a
	 *  map, a list holding anything but strings, or null. */
	bool TreeToScalar(const patter::JsonTree& V, patter::PatterValue& Out)
	{
		switch (V.type)
		{
			case patter::JsonTree::Bool: Out = patter::PatterValue::Bool(V.b); return true;
			case patter::JsonTree::Number: Out = patter::PatterValue::Num(V.num); return true;
			case patter::JsonTree::String: Out = patter::PatterValue::Str(V.str); return true;
			case patter::JsonTree::Array:
			{
				std::vector<std::string> Flags;
				for (const patter::JsonTree& Item : V.arr)
				{
					if (!Item.isString()) return false;
					Flags.push_back(Item.str);
				}
				Out = patter::PatterValue::Flags(std::move(Flags));
				return true;
			}
			default: return false;
		}
	}

	const FPatterExtensionValues* ExtensionNamed(const TArray<FPatterExtensionValues>& Extensions, const FString& Extension)
	{
		return Extensions.FindByPredicate([&Extension](const FPatterExtensionValues& E) { return E.Extension == Extension; });
	}
}

TArray<FPatterGameDataField> UPatterGameData::GameDataFields(UPatterBundle* Bundle, const FString& Kind)
{
	TArray<FPatterGameDataField> Out;
	if (!Bundle || !Bundle->Raw()) return Out;
	for (const patter::GameDataField& F : patter::gameDataFields(*Bundle->Raw(), std::string(TCHAR_TO_UTF8(*Kind))))
	{
		FPatterGameDataField Field;
		Field.Name = Ue(F.name);
		Field.Type = FieldType(F.type);
		Field.TypeName = Ue(F.type);
		Field.bHasDefault = F.hasDefault;
		if (F.hasDefault)
		{
			Field.Default = Ue(F.def.toDisplayString());
			Field.TypedDefault = ToUeValue(F.def);
			Field.DefaultJson = Ue(patter::jsonText(ValueTree(F.def)));
		}
		for (const std::string& V : F.values) Field.Values.Add(Ue(V));
		for (const std::string& S : F.stages) Field.Stages.Add(Ue(S));
		Field.Purpose = Ue(F.purpose);
		Out.Add(Field);
	}
	return Out;
}

bool UPatterGameData::GameDataValue(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node, const FString& Name, FString& OutValue, FPatterValue& OutTypedValue)
{
	OutValue = FString();
	OutTypedValue = FPatterValue();
	if (const FPatterGameDataEntry* E = Find(Node, Name)) { OutValue = E->Value; OutTypedValue = E->TypedValue; return true; }
	for (const FPatterGameDataField& F : Fields)
		if (F.Name == Name)
		{
			if (!F.bHasDefault) return false;
			OutValue = F.Default;
			OutTypedValue = F.TypedDefault;
			return true;
		}
	return false;
}

TArray<FPatterGameDataEntry> UPatterGameData::EffectiveGameData(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node)
{
	TArray<FPatterGameDataEntry> Out;
	for (const FPatterGameDataField& F : Fields)
	{
		if (const FPatterGameDataEntry* E = Find(Node, F.Name)) { Out.Add(*E); continue; }
		if (!F.bHasDefault) continue;
		FPatterGameDataEntry Entry;
		Entry.Name = F.Name;
		Entry.Type = F.Type;
		Entry.Value = F.Default;
		Entry.TypedValue = F.TypedDefault;
		Out.Add(Entry);
	}
	for (const FPatterGameDataEntry& E : Node)
		if (!Find(Out, E.Name)) Out.Add(E);
	return Out;
}

TArray<FPatterGameDataField> UPatterGameData::ExtensionDecls(UPatterBundle* Bundle, const FString& Extension, const FString& Kind)
{
	TArray<FPatterGameDataField> Out;
	if (!Bundle || !Bundle->Raw()) return Out;
	for (const patter::ExtensionFieldDecl& D : patter::extensionDecls(*Bundle->Raw(), Std(Extension), Std(Kind)))
	{
		FPatterGameDataField Field;
		Field.Name = Ue(D.name);
		Field.Type = FieldType(D.type);
		Field.TypeName = Ue(D.type);
		if (D.values) for (const std::string& V : *D.values) Field.Values.Add(Ue(V));
		if (D.stages) for (const std::string& S : *D.stages) Field.Stages.Add(Ue(S));
		if (D.defaultValue)
		{
			Field.bHasDefault = true;
			Field.DefaultJson = Ue(patter::jsonText(*D.defaultValue));
			patter::PatterValue Scalar;
			if (TreeToScalar(*D.defaultValue, Scalar))
			{
				Field.Default = Ue(Scalar.toDisplayString());
				Field.TypedDefault = ToUeValue(Scalar);
			}
		}
		Out.Add(MoveTemp(Field));
	}
	return Out;
}

TArray<FPatterExtensionValues> UPatterGameData::ExtensionsOf(UPatterBundle* Bundle, const FString& Kind, const FString& Address)
{
	if (!Bundle || !Bundle->Raw()) return {};
	return ToUeExtensions(patter::extensionsOf(*Bundle->Raw(), Std(Kind), Std(Address)));
}

TArray<FPatterExtensionEntry> UPatterGameData::GetEffectiveExtensionValues(UPatterBundle* Bundle, const FString& Kind, const FString& Extension,
	const TArray<FPatterExtensionValues>& Extensions)
{
	// The core's effectiveGameData over extension declarations, done on the text: a value the node sets
	// crosses back exactly as it came, never re-printed.
	const FPatterExtensionValues* Own = ExtensionNamed(Extensions, Extension);
	const TArray<FPatterExtensionEntry> Values = Own ? Own->Values : TArray<FPatterExtensionEntry>();
	if (!Bundle || !Bundle->Raw()) return Values;
	TArray<FPatterExtensionEntry> Out;
	for (const patter::ExtensionFieldDecl& D : patter::extensionDecls(*Bundle->Raw(), Std(Extension), Std(Kind)))
	{
		const FString Name = Ue(D.name);
		if (const FPatterExtensionEntry* Set = Values.FindByPredicate([&Name](const FPatterExtensionEntry& E) { return E.Name == Name; }))
		{
			Out.Add(*Set);
		}
		else if (D.defaultValue)
		{
			FPatterExtensionEntry Entry;
			Entry.Name = Name;
			Entry.Json = Ue(patter::jsonText(*D.defaultValue));
			Out.Add(MoveTemp(Entry));
		}
	}
	for (const FPatterExtensionEntry& E : Values)
	{
		if (!Out.ContainsByPredicate([&E](const FPatterExtensionEntry& O) { return O.Name == E.Name; })) Out.Add(E);
	}
	return Out;
}

bool UPatterGameData::FindExtensionValue(const TArray<FPatterExtensionValues>& Extensions, const FString& Extension, const FString& Field, FString& OutJson)
{
	OutJson.Reset();
	const FPatterExtensionValues* Own = ExtensionNamed(Extensions, Extension);
	if (!Own) return false;
	const FPatterExtensionEntry* Entry = Own->Values.FindByPredicate([&Field](const FPatterExtensionEntry& E) { return E.Name == Field; });
	if (!Entry) return false;
	OutJson = Entry->Json;
	return true;
}

bool UPatterGameData::ExtensionValueToScalar(const FString& Json, FPatterValue& OutValue)
{
	OutValue = FPatterValue();
	try
	{
		patter::PatterValue Scalar;
		if (!TreeToScalar(patter::parseJsonText(Std(Json)), Scalar)) return false;
		OutValue = ToUeValue(Scalar);
		return true;
	}
	catch (const std::exception&)
	{
		return false;
	}
}

namespace
{
	std::vector<std::string> LadderOf(const FPatterGameDataField& Field)
	{
		std::vector<std::string> Out;
		for (const FString& S : Field.Stages) Out.push_back(Std(S));
		return Out;
	}
}

int32 UPatterGameData::StageIndex(const FPatterGameDataField& Field, const FString& Stage)
{
	return wildwinter::expr::StageIndex(LadderOf(Field), patter::PatterValue::Str(Std(Stage)));
}

bool UPatterGameData::CompareStages(const FPatterGameDataField& Field, const FString& A, const FString& B, int32& OutOrder)
{
	OutOrder = 0;
	try { OutOrder = wildwinter::expr::CompareStages(LadderOf(Field), patter::PatterValue::Str(Std(A)), patter::PatterValue::Str(Std(B))); return true; }
	catch (const std::exception& Ex) { UE_LOG(LogPatterplay, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

bool UPatterGameData::NextStage(const FPatterGameDataField& Field, const FString& Stage, FString& OutStage)
{
	OutStage = FString();
	try { OutStage = Ue(wildwinter::expr::NextStage(LadderOf(Field), patter::PatterValue::Str(Std(Stage)))); return true; }
	catch (const std::exception& Ex) { UE_LOG(LogPatterplay, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

double UPatterGameData::EstimateLineDuration(const FString& Text, const FString& Locale, double SyllablesPerSecond)
{
	return patter::estimateLineDuration(Std(Text), Std(Locale), SyllablesPerSecond);
}

TArray<FPatterSpeechUnit> UPatterGameData::SpeechUnits(const FString& Text, const FString& Locale)
{
	TArray<FPatterSpeechUnit> Out;
	for (const patter::SpeechUnit& U : patter::speechUnits(Std(Text), Std(Locale)))
	{
		FPatterSpeechUnit& Unit = Out.AddDefaulted_GetRef();
		Unit.Kind = U.kind == patter::SpeechUnitKind::Pause ? EPatterSpeechUnitKind::Pause
			: U.kind == patter::SpeechUnitKind::Closed ? EPatterSpeechUnitKind::Closed : EPatterSpeechUnitKind::Syllable;
		Unit.Weight = U.weight;
		Unit.Start = U.start;
		Unit.End = U.end;
	}
	return Out;
}

double UPatterGameData::CountSyllables(const FString& Text, const FString& Locale)
{
	return patter::countSyllables(Std(Text), Std(Locale));
}
