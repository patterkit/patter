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
		if (F.hasDefault)
		{
			Field.Default = Ue(F.def.toDisplayString());
			Field.TypedDefault = ToUeValue(F.def);
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
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

bool UPatterGameData::NextStage(const FPatterGameDataField& Field, const FString& Stage, FString& OutStage)
{
	OutStage = FString();
	try { OutStage = Ue(wildwinter::expr::NextStage(LadderOf(Field), patter::PatterValue::Str(Std(Stage)))); return true; }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}
