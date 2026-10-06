#include "PatterGameData.h"

#include "PatterBundle.h"
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
		Field.bHasDefault = F.hasDefault;
		if (F.hasDefault) Field.Default = Ue(F.def.toDisplayString());
		for (const std::string& V : F.values) Field.Values.Add(Ue(V));
		Field.Purpose = Ue(F.purpose);
		Out.Add(Field);
	}
	return Out;
}

bool UPatterGameData::GameDataValue(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node, const FString& Name, FString& OutValue)
{
	OutValue = FString();
	if (const FPatterGameDataEntry* E = Find(Node, Name)) { OutValue = E->Value; return true; }
	for (const FPatterGameDataField& F : Fields)
		if (F.Name == Name)
		{
			if (!F.bHasDefault) return false;
			OutValue = F.Default;
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
		Out.Add(Entry);
	}
	for (const FPatterGameDataEntry& E : Node)
		if (!Find(Out, E.Name)) Out.Add(E);
	return Out;
}
